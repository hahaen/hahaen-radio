import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { Star, Play, Trash2, Download, Upload, History } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StationDetail } from '@haen/contracts';
import { Modal } from '../app/Modal';
import { EmptyState } from '../app/EmptyState';
import { exportFavorites, readTransfer, LibraryError, type SavedStation } from './model';
import type { Library } from './store';
import styles from './library.module.css';
interface Lookup {
  items: StationDetail[];
  missing: string[];
}
const definitelyUnavailable = (station: StationDetail | undefined) =>
  station?.availability === 'blocked' || station?.availability === 'unavailable';
export function LibraryPanel({
  library,
  lookup,
  lookupError,
  checking,
  onRefresh,
  onOpen,
  onClose,
}: {
  library: Library;
  lookup: Lookup | undefined;
  lookupError: boolean;
  checking: boolean;
  onRefresh(): void;
  onOpen(id: string): void;
  onClose(): void;
}) {
  const { t, i18n } = useTranslation();
  const state = useStore(library.store);
  const [view, setView] = useState<'favorites' | 'history'>('favorites');
  const [page, setPage] = useState(0),
    [confirm, setConfirm] = useState<'cleanup' | 'history' | null>(null);
  const [message, setMessage] = useState(''),
    [parts, setParts] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  const upload = useRef<HTMLInputElement>(null),
    task = useRef(0);
  useEffect(
    () => () => {
      task.current++;
    },
    [],
  );
  const known = new Map(lookup?.items.map((item) => [item.id, item]));
  const missing = new Set(lookup?.missing),
    favoriteIds = new Set(state.favorites.map((item) => item.id));
  const unavailable = state.favorites.filter(
    (item) => missing.has(item.id) || definitelyUnavailable(known.get(item.id)),
  );
  const canClean = !!lookup && !lookupError && !checking;
  const rows = view === 'favorites' ? state.favorites : state.history;
  const offset = Math.min(page * 30, Math.max(0, Math.floor((rows.length - 1) / 30) * 30));
  const download = (body: string, index: number) => {
    const url = URL.createObjectURL(new Blob([body], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `haen-favorites-${index + 1}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const toggle = (item: SavedStation) => {
    try {
      library.toggleFavorite(item);
    } catch {
      setMessage(t('libraryCapacity'));
    }
  };
  return (
    <Modal title={t('myListening')} onClose={onClose}>
      <div className={styles.libraryTabs} role="group" aria-label={t('listeningLists')}>
        <button
          aria-label={t('favoriteStations', { count: state.favorites.length })}
          aria-pressed={view === 'favorites'}
          onClick={() => {
            setView('favorites');
            setPage(0);
            setConfirm(null);
          }}
        >
          <span>{t('favoriteStationsTab')}</span>
          <small>{t('listeningCount', { count: state.favorites.length })}</small>
        </button>
        <button
          aria-label={t('recentStations', { count: state.history.length })}
          aria-pressed={view === 'history'}
          onClick={() => {
            setView('history');
            setPage(0);
            setConfirm(null);
          }}
        >
          <span>{t('recentStationsTab')}</span>
          <small>{t('listeningCount', { count: state.history.length })}</small>
        </button>
      </div>
      {state.storageProblem && (
        <p className={styles.warning}>{t('storage.' + state.storageProblem)}</p>
      )}
      <>
        {rows.length > 0 && (
          <div className={styles.actions}>
            {view === 'favorites' ? (
              <>
                <button onClick={onRefresh} disabled={checking || !state.favorites.length}>
                  {t(checking ? 'checkingFavorites' : 'refreshFavorites')}
                </button>
                <button
                  onClick={() => setConfirm('cleanup')}
                  disabled={!canClean || !unavailable.length}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {t('cleanFavorites', { count: canClean ? unavailable.length : 0 })}
                </button>
              </>
            ) : (
              <button onClick={() => setConfirm('history')} disabled={!rows.length}>
                <Trash2 size={16} aria-hidden="true" />
                {t('clearHistory')}
              </button>
            )}
          </div>
        )}
        {lookupError && view === 'favorites' && (
          <p className={styles.hint}>{t('favoriteCheckError')}</p>
        )}
        {confirm && (
          <div className={styles.confirm}>
            <p>
              {t(confirm === 'cleanup' ? 'confirmCleanFavorites' : 'confirmClearHistory', {
                count: unavailable.length,
              })}
            </p>
            <button
              disabled={confirm === 'cleanup' && !canClean}
              onClick={() => {
                if (confirm === 'cleanup')
                  library.removeFavorites(unavailable.map((item) => item.id));
                else library.clearHistory();
                setConfirm(null);
              }}
            >
              {t('confirmRemove')}
            </button>
            <button onClick={() => setConfirm(null)}>{t('cancel')}</button>
          </div>
        )}
        {rows.length ? (
          <ul className={styles.savedList}>
            {rows.slice(offset, offset + 30).map((item) => {
              const detail = known.get(item.id),
                gone = missing.has(item.id),
                blocked = detail?.availability === 'blocked',
                displayName = detail?.name ?? item.name;
              const unavailable = gone || definitelyUnavailable(detail);
              return (
                <li key={item.id}>
                  <div className={styles.savedText}>
                    <strong>{displayName}</strong>
                    <span>
                      {unavailable
                        ? t(blocked ? 'savedBlocked' : gone ? 'savedMissing' : 'savedUnavailable')
                        : view === 'history'
                          ? new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : 'zh-CN', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            }).format(item.savedAt)
                          : t(
                              detail?.availability === 'available'
                                ? 'savedAvailable'
                                : 'savedUnknown',
                            )}
                    </span>
                  </div>
                  <button
                    aria-label={t('listenStation', { name: displayName })}
                    disabled={!!unavailable}
                    onClick={() => onOpen(item.id)}
                  >
                    <Play size={20} aria-hidden="true" />
                  </button>
                  <button
                    aria-label={t(
                      favoriteIds.has(item.id) ? 'unfavoriteStation' : 'favoriteStation',
                      { name: displayName },
                    )}
                    aria-pressed={favoriteIds.has(item.id)}
                    onClick={() => toggle(item)}
                  >
                    <Star
                      size={20}
                      fill={favoriteIds.has(item.id) ? 'currentColor' : 'none'}
                      aria-hidden="true"
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            icon={view === 'favorites' ? Star : History}
            title={t(view === 'favorites' ? 'emptyFavoritesTitle' : 'emptyHistoryTitle')}
          >
            {t(view === 'favorites' ? 'noFavorites' : 'noHistory')}
          </EmptyState>
        )}
        {rows.length > 30 && (
          <nav className={styles.pagination} aria-label={t('listeningLists')}>
            <button
              disabled={offset === 0}
              onClick={() => setPage(Math.max(0, Math.floor(offset / 30) - 1))}
            >
              {t('earlier')}
            </button>
            <span>{t('pageNumber', { page: Math.floor(offset / 30) + 1 })}</span>
            <button
              disabled={offset + 30 >= rows.length}
              onClick={() => setPage(Math.floor(offset / 30) + 1)}
            >
              {t('later')}
            </button>
          </nav>
        )}
      </>
      <section className={styles.transfer} aria-labelledby="transfer-heading">
        <h3 id="transfer-heading">{t('transferFavorites')}</h3>
        <p>{t('transferDescription')}</p>
        {state.songs.length > 0 && <p>{t('retainedSongs', { count: state.songs.length })}</p>}
        <div className={styles.actions}>
          <button
            onClick={() => {
              const output = exportFavorites(state.favorites, state.songs);
              setParts(output);
              if (output.length === 1) download(output[0]!, 0);
            }}
          >
            <Download size={18} aria-hidden="true" />
            {t('exportFavorites')}
          </button>
          <button disabled={busy} onClick={() => upload.current?.click()}>
            <Upload size={18} aria-hidden="true" />
            {t(busy ? 'importingFavorites' : 'importFavorites')}
          </button>
        </div>
        <input
          ref={upload}
          hidden
          type="file"
          accept="application/json,.json"
          aria-label={t('importFavorites')}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            const token = ++task.current;
            setBusy(true);
            setMessage('');
            void readTransfer(file)
              .then((data) => {
                if (token !== task.current) return;
                const result = library.importFavorites(data);
                setMessage(t('importResult', result));
                setParts([]);
              })
              .catch((error: unknown) => {
                if (token === task.current)
                  setMessage(
                    t(
                      error instanceof LibraryError
                        ? 'importError.' + error.code
                        : 'importError.format',
                    ),
                  );
              })
              .finally(() => {
                if (token === task.current) setBusy(false);
              });
          }}
        />
        {parts.length > 1 && (
          <div className={styles.parts}>
            <p>{t('exportParts', { count: parts.length })}</p>
            {parts.map((body, index) => (
              <button key={index} onClick={() => download(body, index)}>
                {t('downloadPart', { number: index + 1 })}
              </button>
            ))}
          </div>
        )}
        <p aria-live="polite">{message}</p>
      </section>
    </Modal>
  );
}
