import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { AppConfig } from '../types';

interface HomeScreenProps {
  config: AppConfig;
  onOpenDownload: () => void;
  onOpenQuiz: () => void;
  onSettingsClick: () => void;
  onToggleTheme?: () => void;
}

export function HomeScreen({ config, onOpenDownload, onOpenQuiz, onSettingsClick, onToggleTheme }: HomeScreenProps) {
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  return (
    <div className="screen home-screen">
      <div className="home-topbar">
        <div className="home-logo">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
          {appVersion && <span className="home-logo-version">v{appVersion}</span>}
        </div>
        {onToggleTheme && (
          <button className="home-settings-btn" onClick={onToggleTheme} title="Changer le thème">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          </button>
        )}
        <button className="home-settings-btn" onClick={onSettingsClick} title="Paramètres">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      <div className="home-body">
        <div className="home-hero">
          <p className="home-hero-eyebrow">Bienvenue</p>
          <h1 className="home-hero-title">Que veux-tu faire ?</h1>
          <p className="home-hero-sub">Télécharge de la musique ou lance un blind test depuis tes playlists.</p>
        </div>

        <div className="home-modules">
          <button className="home-module-card home-module-download" onClick={onOpenDownload}>
            <div className="home-module-icon-wrap home-module-icon-dl">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
            <div className="home-module-content">
              <h2 className="home-module-title">Télécharger</h2>
              <p className="home-module-desc">Importe des morceaux depuis YouTube ou Deezer en MP3 pour les écouter hors ligne.</p>
              <div className="home-module-tags">
                <span className="home-tag">YouTube</span>
                <span className="home-tag">Deezer</span>
                <span className="home-tag">MP3</span>
              </div>
            </div>
            <div className="home-module-arrow">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </div>
          </button>

          <button className="home-module-card home-module-quiz" onClick={onOpenQuiz}>
            <div className="home-module-icon-wrap home-module-icon-quiz">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>
            <div className="home-module-content">
              <h2 className="home-module-title">Quizz musical</h2>
              <p className="home-module-desc">Blind test depuis une playlist Deezer. QCM, saisie libre, multi-joueurs — à toi de jouer !</p>
              <div className="home-module-tags">
                <span className="home-tag">Blind test</span>
                <span className="home-tag">Multi-joueurs</span>
                <span className="home-tag">Scores</span>
              </div>
            </div>
            <div className="home-module-arrow">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </div>
          </button>
        </div>

        {config.download_dir && (
          <div className="home-footer">
            <span className="home-footer-icon">📁</span>
            <span className="home-footer-path">{config.download_dir}</span>
          </div>
        )}
      </div>
    </div>
  );
}
