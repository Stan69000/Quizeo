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

const CATEGORIES = [
  { icon: '🎵', label: 'Musique' },
  { icon: '🎬', label: 'Cinéma' },
  { icon: '📺', label: 'Séries' },
  { icon: '🎮', label: 'Gaming' },
  { icon: '🌍', label: 'Années 80–2000' },
];

export function HomeScreen({ onOpenDownload, onOpenQuiz, onSettingsClick, onToggleTheme }: HomeScreenProps) {
  const [appVersion, setAppVersion] = useState('');
  const [activeCat, setActiveCat] = useState(0);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setInterval(() => setActiveCat((c) => (c + 1) % CATEGORIES.length), 2200);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="qz-home">
      {/* Topbar */}
      <div className="qz-topbar">
        <span className="qz-version">{appVersion ? `v${appVersion}` : ''}</span>
        <div className="qz-topbar-actions">
          {onToggleTheme && (
            <button className="qz-icon-btn" onClick={onToggleTheme} title="Thème">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            </button>
          )}
          <button className="qz-icon-btn" onClick={onSettingsClick} title="Paramètres">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Hero */}
      <div className="qz-hero">
        <div className="qz-logo-wrap">
          <div className="qz-logo-ring" />
          <span className="qz-logo-emoji">🎵</span>
        </div>

        <h1 className="qz-title">Quizeo</h1>
        <p className="qz-tagline">Le blind test qui rassemble tout le monde</p>

        <div className="qz-cats">
          {CATEGORIES.map((c, i) => (
            <span
              key={c.label}
              className={`qz-cat${i === activeCat ? ' qz-cat--active' : ''}`}
            >
              {c.icon} {c.label}
            </span>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="qz-actions">
        <button className="qz-play-btn" onClick={onOpenQuiz}>
          <span className="qz-play-icon">▶</span>
          <span className="qz-play-label">
            <span className="qz-play-main">Jouer</span>
            <span className="qz-play-sub">Blind test · QCM · Multi-joueurs</span>
          </span>
        </button>

        <button className="qz-dl-btn" onClick={onOpenDownload}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Télécharger de la musique
        </button>
      </div>

      <div className="qz-orb qz-orb--1" />
      <div className="qz-orb qz-orb--2" />
      <div className="qz-orb qz-orb--3" />
    </div>
  );
}
