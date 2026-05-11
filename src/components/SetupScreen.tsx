/**
 * SetupScreen - First-time setup for Quizeo
 * Allows user to select download folder for the downloader feature
 */

import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

interface SetupScreenProps {
  onSetupComplete: () => void;
}

export function SetupScreen({ onSetupComplete }: SetupScreenProps) {
  const [loading, setLoading] = useState(false);

  const handleSelectFolder = async () => {
    try {
      setLoading(true);

      // Open folder picker dialog
      const selected = await open({
        directory: true,
        title: 'Sélectionner le dossier de téléchargement',
      });

      if (selected && typeof selected === 'string') {
        // Save the selected directory to config
        await invoke('save_config', {
          config: {
            download_dir: selected,
          },
        });

        // Trigger completion callback
        onSetupComplete();
      }
    } catch (error) {
      console.error('Error selecting folder:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="screen setup-screen">
      <div className="setup-screen-content">
        <div className="setup-welcome-icon">🎵</div>
        <h1 className="setup-welcome-title">Bienvenue sur Quizeo</h1>
        <p className="setup-welcome-subtitle">
          Blind tests, QCM et jeux musicaux pour petits et grands.
          <br />
          Pour la fonction téléchargement, choisis d'abord un dossier.
        </p>
        <button
          className={`setup-folder-button ${loading ? 'loading' : ''}`}
          onClick={handleSelectFolder}
          disabled={loading}
        >
          {loading ? (
            <>
              <svg
                className="spinner"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="1"></circle>
                <path d="M12 1v6"></path>
                <path d="M12 17v6"></path>
                <path d="M4.22 4.22l4.24 4.24"></path>
                <path d="M15.54 15.54l4.24 4.24"></path>
                <path d="M1 12h6"></path>
                <path d="M17 12h6"></path>
                <path d="M4.22 19.78l4.24-4.24"></path>
                <path d="M15.54 8.46l4.24-4.24"></path>
              </svg>
              Ouverture du sélecteur...
            </>
          ) : (
            <>
              <span className="icon">📁</span>
              Choisir un dossier de téléchargement
            </>
          )}
        </button>
      </div>
    </div>
  );
}
