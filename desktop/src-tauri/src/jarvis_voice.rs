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
//! Voice *output* stays in the frontend (browser `speechSynthesis`), since the
//! native TTS command is likewise huddle-gated.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use tauri::{ipc::InvokeBody, AppHandle, Emitter, State};

use crate::app_state::AppState;
use crate::huddle::{models, stt::SttPipeline};

/// Cap per audio batch — mirrors the huddle path's `MAX_AUDIO_BATCH_BYTES`.
const MAX_AUDIO_BATCH_BYTES: usize = 100 * 1024;

/// Managed state for the JARVIS voice session. Independent of `HuddleState`.
#[derive(Default)]
pub struct JarvisVoiceState {
    pipeline: Option<Arc<SttPipeline>>,
    /// Push-to-talk gate handed to the STT worker: audio is only transcribed
    /// (and finalized) while this is true.
    ptt_active: Option<Arc<AtomicBool>>,
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
