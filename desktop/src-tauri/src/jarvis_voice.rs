//! Standalone push-to-talk voice input for the JARVIS HUD.
//!
//! The huddle STT pipeline is gated on an active huddle (`HuddleState.phase`)
//! and posts finalized transcripts to the relay as kind:9 events. JARVIS needs
//! neither: it runs a **decoupled** `SttPipeline` that is driven by a
//! push-to-talk flag and delivers each finalized utterance to the *frontend*
//! as a `jarvis-transcript` Tauri event. The HUD then sends that text to the
//! concierge agent itself (an explicit @mention), so no huddle, no relay post,
//! and no `HuddleState` coupling are involved.
//!
//! Voice *output* is likewise decoupled: `jarvis_speak` runs its own Pocket TTS
//! pipeline (the huddle's `speak_agent_message` is gated on an active huddle),
//! and `jarvis_google_tts` proxies Google Chirp 3: HD so the API key stays in
//! this process and never reaches browser JS.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use tauri::{ipc::InvokeBody, AppHandle, Emitter, State};

use crate::app_state::AppState;
use crate::huddle::{models, stt::SttPipeline, tts::TtsPipeline};

/// Cap per audio batch — mirrors the huddle path's `MAX_AUDIO_BATCH_BYTES`.
const MAX_AUDIO_BATCH_BYTES: usize = 100 * 1024;

/// Cap on a single synthesis request, mirroring the huddle's `MAX_TTS_TEXT_LEN`.
const MAX_TTS_TEXT_LEN: usize = 2000;

/// Managed state for the JARVIS voice session. Independent of `HuddleState`.
#[derive(Default)]
pub struct JarvisVoiceState {
    pipeline: Option<Arc<SttPipeline>>,
    /// Push-to-talk gate handed to the STT worker: audio is only transcribed
    /// (and finalized) while this is true.
    ptt_active: Option<Arc<AtomicBool>>,
    /// Standalone Pocket TTS pipeline — the huddle's `speak_agent_message` is
    /// gated on an active huddle, so JARVIS runs its own.
    tts: Option<Arc<TtsPipeline>>,
    /// Barge-in / kill-switch flag observed by the TTS worker and its monitor
    /// thread. Setting it silences playback within ~15ms.
    tts_cancel: Arc<AtomicBool>,
    /// "TTS is speaking" gate (the huddle uses this to duck the mic).
    tts_active: Arc<AtomicBool>,
}

impl JarvisVoiceState {
    fn teardown(&mut self) {
        if let Some(pipeline) = self.pipeline.take() {
            pipeline.shutdown();
        }
        self.ptt_active = None;
    }
}

/// Start (or restart) the JARVIS listening session. Constructs a standalone STT
/// pipeline and spawns a task that forwards each finalized utterance to the
/// frontend as a `jarvis-transcript` event. Idempotent — replaces any existing
/// session.
#[tauri::command]
pub async fn jarvis_start_listening(
    app: AppHandle,
    jarvis: State<'_, Mutex<JarvisVoiceState>>,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    // Kick a model download if needed; STT can't run until it's present.
    if !models::is_stt_ready() {
        if let Some(manager) = models::global_model_manager() {
            manager.start_stt_download(app_state.http_client.clone());
        }
        return Err("STT model is still downloading — try again in a moment".into());
    }
    let model_dir = models::stt_model_dir().ok_or("STT model directory not found")?;

    // Fresh push-to-talk gate, starting closed (nothing transcribed until held).
    let ptt_active = Arc::new(AtomicBool::new(false));
    let tts_active = Arc::new(AtomicBool::new(false));

    let ptt_for_stt = Arc::clone(&ptt_active);
    let (pipeline, mut text_rx) = tokio::task::spawn_blocking(move || {
        SttPipeline::new(model_dir, tts_active, None, Some(ptt_for_stt))
    })
    .await
    .map_err(|e| format!("spawn_blocking failed: {e}"))??;

    // Forward finalized transcripts to the HUD. The task ends when the pipeline
    // is shut down (its sender drops → recv() returns None).
    tauri::async_runtime::spawn(async move {
        while let Some(text) = text_rx.recv().await {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                continue;
            }
            let _ = app.emit("jarvis-transcript", trimmed.to_string());
        }
    });

    let mut state = jarvis.lock().map_err(|e| e.to_string())?;
    state.teardown();
    state.pipeline = Some(Arc::new(pipeline));
    state.ptt_active = Some(ptt_active);
    Ok(())
}

/// Stop the JARVIS listening session and release the STT pipeline.
#[tauri::command]
pub fn jarvis_stop_listening(jarvis: State<'_, Mutex<JarvisVoiceState>>) -> Result<(), String> {
    jarvis.lock().map_err(|e| e.to_string())?.teardown();
    Ok(())
}

/// Hold/release the push-to-talk gate. `true` while the user holds the mic
/// button; `false` on release triggers the STT worker to finalize the utterance.
#[tauri::command]
pub fn jarvis_set_ptt(
    active: bool,
    jarvis: State<'_, Mutex<JarvisVoiceState>>,
) -> Result<(), String> {
    let state = jarvis.lock().map_err(|e| e.to_string())?;
    if let Some(ref flag) = state.ptt_active {
        flag.store(active, Ordering::Release);
    }
    Ok(())
}

/// Receive raw PCM (f32 LE, 48 kHz mono) from the AudioWorklet and feed the
/// JARVIS STT pipeline. Silently discards audio when no session is active.
#[tauri::command]
pub fn jarvis_push_audio(
    request: tauri::ipc::Request<'_>,
    jarvis: State<'_, Mutex<JarvisVoiceState>>,
) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw binary body".into());
    };
    if bytes.len() > MAX_AUDIO_BATCH_BYTES {
        return Err(format!(
            "audio batch too large: {} bytes (max {})",
            bytes.len(),
            MAX_AUDIO_BATCH_BYTES
        ));
    }
    let state = jarvis.lock().map_err(|e| e.to_string())?;
    if let Some(ref pipeline) = state.pipeline {
        pipeline.push_audio(bytes.to_vec())?;
    }
    Ok(())
}

// ── Text-to-speech ───────────────────────────────────────────────────────────

/// Speak `text` through JARVIS's own Pocket TTS pipeline.
///
/// The huddle's `speak_agent_message` requires an active huddle; this one has no
/// such gate, so the HUD can talk on its own. The pipeline is built lazily on
/// first use (~200ms of ONNX session loading) and then reused.
#[tauri::command]
pub async fn jarvis_speak(
    text: String,
    jarvis: State<'_, Mutex<JarvisVoiceState>>,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    let text = if text.chars().count() > MAX_TTS_TEXT_LEN {
        text.chars().take(MAX_TTS_TEXT_LEN).collect()
    } else {
        text
    };

    // Reuse an existing pipeline if we have one.
    let existing = {
        let state = jarvis.lock().map_err(|e| e.to_string())?;
        state.tts.clone()
    };
    if let Some(pipeline) = existing {
        return pipeline.speak(text);
    }

    if !models::is_tts_ready() {
        if let Some(manager) = models::global_model_manager() {
            manager.start_tts_download(app_state.http_client.clone());
        }
        return Err("voice model is still downloading — try again shortly".into());
    }
    let model_dir = models::tts_model_dir().ok_or("TTS model directory not found")?;

    let (cancel, active) = {
        let state = jarvis.lock().map_err(|e| e.to_string())?;
        (Arc::clone(&state.tts_cancel), Arc::clone(&state.tts_active))
    };
    cancel.store(false, Ordering::Release);

    let output_device = app_state
        .audio_output_device
        .lock()
        .ok()
        .and_then(|d| d.clone());
    let built = tokio::task::spawn_blocking(move || {
        TtsPipeline::new(model_dir, active, cancel, output_device)
    })
    .await
    .map_err(|e| format!("spawn_blocking failed: {e}"))??;
    let pipeline = Arc::new(built);

    {
        let mut state = jarvis.lock().map_err(|e| e.to_string())?;
        // Another call may have won the race while we were constructing.
        if let Some(existing) = state.tts.clone() {
            drop(pipeline);
            return existing.speak(text);
        }
        state.tts = Some(Arc::clone(&pipeline));
    }
    pipeline.speak(text)
}

/// Kill switch — silence anything currently being spoken.
///
/// Sets the barge-in flag the TTS worker and its monitor thread watch; the
/// monitor clears the audio player within ~15ms. The worker consumes the flag
/// and drains its queue, so speech stops without tearing the pipeline down.
#[tauri::command]
pub fn jarvis_stop_speaking(jarvis: State<'_, Mutex<JarvisVoiceState>>) -> Result<(), String> {
    let state = jarvis.lock().map_err(|e| e.to_string())?;
    state.tts_cancel.store(true, Ordering::Release);
    Ok(())
}

/// Google service-account key file. Cloud Text-to-Speech rejects API keys
/// ("API keys are not supported by this API"), so auth is a signed JWT
/// exchanged for a short-lived OAuth2 access token.
fn google_service_account_path() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let path = std::path::Path::new(&home)
        .join(".buzz")
        .join("jarvis-tts-google.json");
    path.exists().then_some(path)
}

#[derive(serde::Deserialize)]
struct GoogleServiceAccount {
    client_email: String,
    private_key: String,
}

#[derive(serde::Serialize)]
struct JwtClaims<'a> {
    iss: &'a str,
    scope: &'a str,
    aud: &'a str,
    exp: u64,
    iat: u64,
}

/// Cached access token and its unix-seconds expiry. Google's tokens last an
/// hour; re-signing per request would add latency and pointless load.
static GOOGLE_TOKEN: std::sync::Mutex<Option<(String, u64)>> = std::sync::Mutex::new(None);

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Mint (or reuse) an OAuth2 access token for the Cloud TTS scope.
async fn google_access_token(client: &reqwest::Client) -> Result<String, String> {
    const SKEW: u64 = 60;
    if let Ok(guard) = GOOGLE_TOKEN.lock() {
        if let Some((token, expires_at)) = guard.as_ref() {
            if *expires_at > unix_now() + SKEW {
                return Ok(token.clone());
            }
        }
    }

    let path = google_service_account_path()
        .ok_or("no ~/.buzz/jarvis-tts-google.json service-account key")?;
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("read key file: {e}"))?;
    let account: GoogleServiceAccount =
        serde_json::from_str(&raw).map_err(|e| format!("parse key file: {e}"))?;

    let now = unix_now();
    let claims = JwtClaims {
        iss: &account.client_email,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        aud: "https://oauth2.googleapis.com/token",
        exp: now + 3600,
        iat: now,
    };
    let key = jsonwebtoken::EncodingKey::from_rsa_pem(account.private_key.as_bytes())
        .map_err(|e| format!("service-account private key is not valid RSA PEM: {e}"))?;
    let assertion = jsonwebtoken::encode(
        &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256),
        &claims,
        &key,
    )
    .map_err(|e| format!("sign jwt: {e}"))?;

    let response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            ("assertion", assertion.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("token request failed: {e}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        return Err(format!(
            "google token {status}: {}",
            detail.chars().take(200).collect::<String>()
        ));
    }
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("token decode failed: {e}"))?;
    let token = payload
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or("token response had no access_token")?
        .to_string();
    let ttl = payload
        .get("expires_in")
        .and_then(|v| v.as_u64())
        .unwrap_or(3600);

    if let Ok(mut guard) = GOOGLE_TOKEN.lock() {
        *guard = Some((token.clone(), unix_now() + ttl));
    }
    Ok(token)
}

/// Which voice providers are usable on this machine right now.
#[derive(serde::Serialize)]
pub struct TtsProviderStatus {
    /// Pocket TTS model present — the local, private, free option.
    pocket_ready: bool,
    /// A Google Cloud TTS API key is configured.
    google_configured: bool,
}

#[tauri::command]
pub fn jarvis_tts_status() -> TtsProviderStatus {
    TtsProviderStatus {
        pocket_ready: models::is_tts_ready(),
        google_configured: google_service_account_path().is_some(),
    }
}

/// Synthesize with Google Cloud TTS (Chirp 3: HD) and return base64 audio.
///
/// The API key stays in this process — the frontend receives only audio bytes,
/// which it plays and can cancel. Returns MP3 so the webview can play it
/// directly without conversion.
#[tauri::command]
pub async fn jarvis_google_tts(
    text: String,
    voice: String,
    app_state: State<'_, AppState>,
) -> Result<String, String> {
    let token = google_access_token(&app_state.http_client).await?;

    // Voice names are `<locale>-Chirp3-HD-<name>`; the locale prefix is also the
    // languageCode the API expects.
    let language_code = voice
        .split_once("-Chirp3")
        .map(|(prefix, _)| prefix.to_string())
        .unwrap_or_else(|| "en-US".to_string());

    let body = serde_json::json!({
        "input": { "text": text },
        "voice": { "languageCode": language_code, "name": voice },
        "audioConfig": { "audioEncoding": "MP3" },
    });

    let response = app_state
        .http_client
        .post("https://texttospeech.googleapis.com/v1/text:synthesize")
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("google tts request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        // Never echo the key back, and keep the excerpt short.
        return Err(format!(
            "google tts {status}: {}",
            detail.chars().take(200).collect::<String>()
        ));
    }

    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("google tts decode failed: {e}"))?;
    payload
        .get("audioContent")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "google tts returned no audioContent".to_string())
}

/// List the Chirp 3: HD voices available to this key, so the picker never shows
/// a voice the account can't actually use.
#[tauri::command]
pub async fn jarvis_google_voices(app_state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let token = google_access_token(&app_state.http_client).await?;

    let response = app_state
        .http_client
        .get("https://texttospeech.googleapis.com/v1/voices")
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("google voices request failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("google voices {}", response.status()));
    }
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("google voices decode failed: {e}"))?;

    let mut names: Vec<String> = payload
        .get("voices")
        .and_then(|v| v.as_array())
        .map(|voices| {
            voices
                .iter()
                .filter_map(|v| v.get("name").and_then(|n| n.as_str()))
                .filter(|n| n.contains("Chirp3-HD"))
                .map(|n| n.to_string())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    Ok(names)
}

/// One seed agent definition, read from `~/.buzz/jarvis-seed-agents.json`.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct SeedAgent {
    pub name: String,
    #[serde(rename = "systemPrompt")]
    pub system_prompt: String,
}

/// Read the user's seed-agent definitions so the frontend can auto-create any
/// that are missing on startup. Returns an empty list when the file is absent —
/// this is dev-only convenience, never an error.
#[tauri::command]
pub fn read_jarvis_seed_agents() -> Result<Vec<SeedAgent>, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let path = std::path::Path::new(&home)
        .join(".buzz")
        .join("jarvis-seed-agents.json");
    match std::fs::read_to_string(&path) {
        Ok(contents) => {
            serde_json::from_str(&contents).map_err(|e| format!("seed file parse error: {e}"))
        }
        Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!("seed file read error: {e}")),
    }
}
