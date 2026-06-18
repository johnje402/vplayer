import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { getCurrentWindow } from "@tauri-apps/api/window";

function fmt(t: number) {
  if (!Number.isFinite(t)) return "00:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState("No video selected");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  async function openVideo() {
    const file = await open({
      multiple: false,
      directory: false,
    });

    if (typeof file !== "string") return;

    const video = videoRef.current;
    if (!video) return;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }

    setPlaying(false);
    setTime(0);
    setDuration(0);
    setName(file.split(/[\\/]/).pop() || file);

    const videoUrl = await invoke<string>("load_video_to_memory", {
      id: "my-video",
      path: file,
    });
    video.src = videoUrl;
    video.controls = true;
    video.play();
  }

  async function togglePlay() {
    const video = videoRef.current;
    if (!video || !video.src) return;

    try {
      if (video.paused) {
        await video.play();
      } else {
        video.pause();
      }
    } catch (e) {
      console.error("Cannot play video:", e);
    }
  }

  function seekBy(seconds: number) {
    const video = videoRef.current;
    if (!video || !duration) return;

    video.currentTime = Math.max(0, Math.min(video.currentTime + seconds, duration));
  }

  function seekTo(value: number) {
    const video = videoRef.current;
    if (!video || !duration) return;

    video.currentTime = value;
    setTime(value);
  }

  function setVideoVolume(value: number) {
    const video = videoRef.current;
    if (!video) return;

    video.volume = value;
    setVolume(value);
  }

  async function toggleFullscreen() {
    const video = videoRef.current;
    if (!video) return;

    try {
      // Browser fullscreen
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      if (video.requestFullscreen) {
        await video.requestFullscreen();
        return;
      }

      // Safari / macOS WebKit fallback
      if ((video as any).webkitEnterFullscreen) {
        (video as any).webkitEnterFullscreen();
        return;
      }
    } catch (err) {
      console.warn("Browser fullscreen failed, using Tauri fullscreen:", err);
    }

    // Tauri fullscreen fallback
    const win = getCurrentWindow();
    const fullscreen = await win.isFullscreen();
    await win.setFullscreen(!fullscreen);
    setIsFullscreen(!fullscreen);
  }

  function keyboardHandler(e: KeyboardEvent) {
    const video = videoRef.current;
    if (!video) return;
    switch (e.key) {
      case "ArrowLeft":
        video.currentTime = Math.max(0, video.currentTime - 5);
        break;

      case "ArrowRight":
        video.currentTime = Math.min(
          video.duration,
          video.currentTime + 5
        );
        break;

      case " ":
        e.preventDefault();

        if (video.paused) {
          video.play();
        } else {
          video.pause();
        }
        break;

      case "f":
        e.preventDefault();
        toggleFullscreen();
        break;
    }
  }

  useEffect(() => {
    window.addEventListener("keydown", keyboardHandler);
    return () => {
      window.removeEventListener("keydown", keyboardHandler);
    }
  }, []);

  return (
    <div className={`app ${isFullscreen ? "fullscreen" : ""}`}>
      <aside className="sidebar">
        <h2>Playlist</h2>

        <div className="playlist-item">
          <div className="thumb">🎬</div>
          <div>
            <strong>{name}</strong>
            <span>{duration ? fmt(duration) : "Ready"}</span>
          </div>
        </div>

        <button className="open-btn" onClick={openVideo}>
          📁 Open Video
        </button>
      </aside>

      <main className="main">
        <header className="topbar">
          <h1>{name === "No video selected" ? "Tauri Video Player" : name}</h1>
          <button onClick={toggleFullscreen}>⛶</button>
        </header>

        <section className="player-card">
          <div className="video-box" ref={playerRef}>
            <video
              ref={videoRef}
              className="video"
              preload="metadata"
              playsInline
              onLoadedMetadata={(e) => {
                setDuration(e.currentTarget.duration || 0);
                e.currentTarget.volume = volume;
              }}
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onError={(e) => console.error("Video error:", e.currentTarget.error)}
            />
          </div>

          <div className="controls">
            <button onClick={() => seekBy(-10)}>↺ 10</button>

            <button className="play-btn" onClick={togglePlay}>
              {playing ? "Pause" : "Play"}
            </button>

            <button onClick={() => seekBy(10)}>10 ↻</button>

            <span className="time">
              {fmt(time)} / {fmt(duration)}
            </span>

            <div className="volume">
              🔊
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => setVideoVolume(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="progress-row">
            <input
              className="progress"
              type="range"
              min="0"
              max={duration || 0}
              step="0.1"
              value={time}
              onChange={(e) => seekTo(Number(e.target.value))}
            />
          </div>
        </section>
      </main>
    </div>
  );
}