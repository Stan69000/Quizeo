import { NetworkPlayer, ScoreDelta } from '../../types';

interface NetworkGameControlProps {
  round: number;
  totalRounds: number;
  answeredCount: number;
  totalPlayers: number;
  phase: 'playing' | 'reveal' | 'scoreboard';
  rankings: NetworkPlayer[];
  deltas: ScoreDelta[];
  correctIndex: number | null;
  options: string[];
  onReveal: () => void;
  onShowScoreboard: () => void;
  onNextRound: () => void;
  onEndGame: () => void;
}

export function NetworkGameControl({
  round, totalRounds,
  answeredCount, totalPlayers,
  phase, rankings, deltas, correctIndex, options,
  onReveal, onShowScoreboard, onNextRound, onEndGame,
}: NetworkGameControlProps) {
  const isLastRound = round >= totalRounds;

  return (
    <div className="net-game">
      <div className="net-game-header">
        <span className="net-round-badge">Round {round} / {totalRounds}</span>
        {phase === 'playing' && (
          <span className="net-answer-count">
            {answeredCount} / {totalPlayers} répondu{answeredCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Live leaderboard */}
      <div className="net-leaderboard">
        {rankings.slice(0, 8).map((p, i) => (
          <div key={p.name} className="net-lb-row" style={{ animationDelay: `${i * 0.04}s` }}>
            <span className="net-lb-rank">{['🥇','🥈','🥉'][i] ?? i + 1}</span>
            <span className="net-lb-name">{p.name}</span>
            {phase === 'reveal' && deltas.find(d => d.name === p.name) && (() => {
              const d = deltas.find(dd => dd.name === p.name)!;
              return (
                <span className={`net-lb-delta ${d.correct ? 'correct' : 'wrong'}`}>
                  {d.correct ? `+${d.delta.toLocaleString('fr')}` : '✗'}
                </span>
              );
            })()}
            <span className="net-lb-score">{p.score.toLocaleString('fr')}</span>
          </div>
        ))}
        {rankings.length === 0 && (
          <div className="net-lb-empty">En attente des réponses…</div>
        )}
      </div>

      {/* Options display during playing */}
      {phase === 'playing' && options.length > 0 && (
        <div className="net-options-preview">
          {options.map((opt, i) => (
            <div
              key={i}
              className={`net-option-preview${correctIndex === i ? ' correct' : ''}`}
            >
              {opt}
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="net-actions">
        {phase === 'playing' && (
          <button className="net-action-btn net-action-reveal" onClick={onReveal}>
            Révéler la réponse
          </button>
        )}
        {phase === 'reveal' && (
          <button className="net-action-btn net-action-scores" onClick={onShowScoreboard}>
            Voir les scores
          </button>
        )}
        {phase === 'scoreboard' && (
          isLastRound ? (
            <button className="net-action-btn net-action-end" onClick={onEndGame}>
              Terminer la partie
            </button>
          ) : (
            <button className="net-action-btn net-action-next" onClick={onNextRound}>
              Round suivant →
            </button>
          )
        )}
      </div>
    </div>
  );
}
