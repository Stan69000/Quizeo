/**
 * Main App component for Quizeo
 * Manages screen navigation, app state, and download queue
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import './App.css';
import './index.css';
import { useConfig } from './hooks/useConfig';
import { useTheme } from './hooks/useTheme';
import { SetupScreen } from './components/SetupScreen';
import { HomeScreen } from './components/HomeScreen';
import { MainScreen } from './components/MainScreen';
import { MiniPlayer } from './components/MiniPlayer';
import { Settings } from './components/Settings';
import { DownloadQueue, DownloadJob } from './components/DownloadQueue';
import { QuizScreen } from './components/QuizScreen';
import { CinemaScreen } from './components/CinemaScreen';
import { AppConfig, TrackInfo, AudioFileInfo } from './types';
import { invoke } from '@tauri-apps/api/core';

type Screen = 'setup' | 'home' | 'main' | 'quiz' | 'cinema';

let jobCounter = 0;

function App() {
  const { config, loading, isConfigured, saveConfig } = useConfig();
  const [, toggleTheme] = useTheme();
  const [currentScreen, setCurrentScreen] = useState<Screen>('setup');
  const [showSettings, setShowSettings] = useState(false);
  const [downloadJobs, setDownloadJobs] = useState<DownloadJob[]>([]);
  const [audioFiles, setAudioFiles] = useState<AudioFileInfo[]>([]);
  const [jukeboxPlay, setJukeboxPlay] = useState<{ path: string; ts: number } | null>(null);

  const handleJukeboxPlay = useCallback((path: string) => {
    setJukeboxPlay({ path, ts: Date.now() });
  }, []);

  const refreshAudioFiles = useCallback(async () => {
    if (!config.download_dir) return;
    try {
      const files = await invoke<AudioFileInfo[]>('scan_downloaded_files', { dir: config.download_dir });
      setAudioFiles(files);
    } catch {
      // dir may not exist yet
    }
  }, [config.download_dir]);

  useEffect(() => {
    refreshAudioFiles();
  }, [refreshAudioFiles]);

  // Only run this routing decision when initial config loading finishes.
  // Without the ref guard, `isConfigured` (a fresh function each render) makes
  // the effect re-fire on every render and resets the screen to 'main',
  // hijacking any user navigation away from main.
  const didInitialRouteRef = useRef(false);
  useEffect(() => {
    if (loading || didInitialRouteRef.current) return;
    didInitialRouteRef.current = true;
    setCurrentScreen(isConfigured() ? 'home' : 'setup');
  }, [loading, isConfigured]);

  const handleSetupComplete = () => {
    setCurrentScreen('home');
  };

  const handleChangeFolder = async (newPath: string) => {
    try {
      await saveConfig({ download_dir: newPath });
    } catch (error) {
      console.error('Error changing folder:', error);
    }
  };

  const handleSettingsSave = async (newConfig: AppConfig): Promise<boolean> => {
    return await saveConfig(newConfig);
  };

  const handleAddToQueue = useCallback((tracks: TrackInfo[]) => {
    jobCounter += 1;
    const job: DownloadJob = {
      id: `job-${jobCounter}-${Date.now()}`,
      tracks,
      outputDir: config.download_dir,
      audioFormat: config.audio_format || 'mp3',
    };
    setDownloadJobs((prev) => [...prev, job]);
  }, [config.download_dir, config.audio_format]);

  const handleJobDone = useCallback((jobId: string) => {
    // Remove completed job from downloadJobs to avoid re-processing after queue clear
    setDownloadJobs((prev) => prev.filter((j) => j.id !== jobId));
  }, []);

  if (loading) {
    return (
      <div className="app">
        <div className="app-container">
          <div className="screen" style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <div style={{ textAlign: 'center' }}>
              <div className="equalizer" style={{ justifyContent: 'center', height: '40px', marginBottom: '20px' }}>
                <div className="equalizer-bar" />
                <div className="equalizer-bar" />
                <div className="equalizer-bar" />
                <div className="equalizer-bar" />
                <div className="equalizer-bar" />
              </div>
              <p style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Chargement...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="app-container">
        {currentScreen === 'setup' && (
          <SetupScreen onSetupComplete={handleSetupComplete} />
        )}

        {currentScreen === 'home' && (
          <HomeScreen
            config={config}
            onOpenDownload={() => setCurrentScreen('main')}
            onOpenQuiz={() => setCurrentScreen('quiz')}
            onOpenCinema={() => setCurrentScreen('cinema')}
            onSettingsClick={() => setShowSettings(true)}
            onToggleTheme={toggleTheme}
          />
        )}

        {currentScreen === 'main' && (
          <MainScreen
            config={config}
            onSettingsClick={() => setShowSettings(true)}
            onChangeFolder={handleChangeFolder}
            onAddToQueue={handleAddToQueue}
            onOpenQuiz={() => setCurrentScreen('quiz')}
            onBack={() => setCurrentScreen('home')}
          />
        )}

        {currentScreen === 'quiz' && (
          <QuizScreen
            onExit={() => setCurrentScreen('home')}
            audioFiles={audioFiles}
            onJukeboxPlay={handleJukeboxPlay}
          />
        )}

        {currentScreen === 'cinema' && (
          <CinemaScreen onExit={() => setCurrentScreen('home')} />
        )}
      </div>

      {currentScreen !== 'quiz' && currentScreen !== 'cinema' && (
        <MiniPlayer files={audioFiles} onRequestRefresh={refreshAudioFiles} externalPlay={jukeboxPlay} />
      )}
      <DownloadQueue jobs={downloadJobs} onJobDone={handleJobDone} />

      {showSettings && (
        <Settings
          config={config}
          onClose={() => setShowSettings(false)}
          onSave={handleSettingsSave}
        />
      )}
    </div>
  );
}

export default App;
