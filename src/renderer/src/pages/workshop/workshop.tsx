import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  Link2,
  Loader2,
  Package,
} from "lucide-react";
import { Button, TextField } from "@renderer/components";
import type { WorkshopInspection, WorkshopResult, WorkshopState } from "@types";
import "./workshop.scss";

export default function Workshop() {
  const { t } = useTranslation("workshop");
  const [state, setState] = useState<WorkshopState | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [inspection, setInspection] = useState<WorkshopInspection | null>(null);
  const [identifying, setIdentifying] = useState(false);
  const logsRef = useRef<HTMLPreElement>(null);
  const applyState = useCallback((next: WorkshopState) => {
    setState((previous) =>
      !previous || next.revision >= previous.revision ? next : previous
    );
  }, []);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = window.electron.onWorkshopStateChanged((next) => {
      if (mounted) applyState(next);
    });
    window.electron
      .getWorkshopState()
      .then((next) => {
        if (mounted) applyState(next);
      })
      .catch(() => {
        if (mounted) setError("connection");
      });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [applyState]);

  useEffect(() => {
    if (logsRef.current)
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [state?.logs]);

  useEffect(() => {
    let current = true;
    setInspection(null);
    setIdentifying(false);
    if (!input.trim()) return;
    const timer = setTimeout(() => {
      setIdentifying(true);
      window.electron
        .inspectWorkshopItem(input.trim())
        .then((result) => {
          if (current) setInspection(result);
        })
        .catch(() => {})
        .finally(() => {
          if (current) setIdentifying(false);
        });
    }, 800);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [input]);

  const run = async (action: () => Promise<WorkshopResult>) => {
    setError(null);
    setPending(true);
    try {
      const result = await action();
      applyState(result.state);
      if (!result.success) setError(result.error ?? "connection");
    } catch {
      setError("connection");
    } finally {
      setPending(false);
    }
  };

  const openFolder = async () => {
    try {
      if (await window.electron.openWorkshopFolder()) setError("folder");
    } catch {
      setError("folder");
    }
  };

  const busy = pending || !!state?.busy;
  const displayError = error ?? state?.error;
  const game =
    inspection?.game ?? (state?.busy || !input.trim() ? state?.game : null);

  return (
    <section className="workshop">
      <div className="workshop__intro">
        <div className="workshop__icon">
          <Link2 size={44} strokeWidth={1.6} />
        </div>
        <h1>{t("title")}</h1>
        <p>{t("description")}</p>
        <a
          href="https://steamcommunity.com/workshop/browse/"
          target="_blank"
          rel="noreferrer"
        >
          {t("browse")} <ExternalLink size={14} />
        </a>
      </div>

      {!state && !error && <p role="status">{t("loading")}</p>}

      {state && !state.supported && (
        <p className="workshop__notice">{t("windows_only")}</p>
      )}

      {state?.supported && (
        <div className="workshop__body">
          <div className="workshop__setup">
            <div className="workshop__setup-label">
              {state.installed ? (
                <CheckCircle2 size={20} />
              ) : (
                <Package size={20} />
              )}
              <div>
                <strong>SteamCMD</strong>
                <p>{t(state.installed ? "ready" : "setup_description")}</p>
              </div>
            </div>
            <Button
              theme="outline"
              disabled={busy}
              onClick={() =>
                void run(() => window.electron.installWorkshopSteamCMD())
              }
            >
              {t(state.installed ? "repair" : "install")}
            </Button>
          </div>

          <form
            className="workshop__form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && state.installed && input.trim()) {
                void run(() =>
                  window.electron.downloadWorkshopItem(input.trim())
                );
              }
            }}
          >
            <TextField
              label={t("link_label")}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                setError(null);
              }}
              placeholder="https://steamcommunity.com/sharedfiles/filedetails/?id=1234567890"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              maxLength={2048}
              disabled={busy}
            />
            {identifying && <p role="status">{t("identifying")}</p>}
            {game && (
              <div className="workshop__game" aria-live="polite">
                <span>{t("detected_game")}</span>
                <strong>
                  {game.name ?? t("unknown_game", { appId: game.appId })}
                </strong>
                <span>Steam App ID: {game.appId}</span>
                <p>
                  {t(
                    game.inHydraLibrary ? "library_match" : "library_not_found"
                  )}
                </p>
                {game.location ? (
                  <>
                    <span>
                      {t(
                        game.location.kind === "steam-install"
                          ? "game_directory"
                          : "executable_directory"
                      )}
                    </span>
                    <code dir="ltr">{game.location.path}</code>
                  </>
                ) : (
                  <p>{t("location_not_found")}</p>
                )}
                <p className="workshop__hint">{t("identified_hint")}</p>
              </div>
            )}
            <div className="workshop__actions">
              <Button
                type="submit"
                className="workshop__download"
                disabled={busy || !state.installed || !input.trim()}
              >
                {busy ? (
                  <Loader2 size={18} className="workshop__spinner" />
                ) : (
                  <ArrowRight size={18} />
                )}
                {t(busy ? "working" : "download")}
              </Button>
              <Button
                theme="outline"
                onClick={() => void openFolder()}
                aria-label={t("open_folder")}
                title={t("open_folder")}
              >
                <FolderOpen size={20} />
              </Button>
            </div>
            <p className="workshop__hint">{t("limitations")}</p>
          </form>

          {state.phase !== "idle" && (
            <div className="workshop__progress">
              <div className="workshop__progress-heading">
                <div role="status" aria-live="polite">
                  <strong>{t(`phase.${state.phase}`)}</strong>
                  {state.item && <p>{state.item.title}</p>}
                  {state.game && (
                    <p>
                      {t("belongs_to", {
                        game:
                          state.game.name ?? `Steam App ${state.game.appId}`,
                      })}
                    </p>
                  )}
                </div>
                {state.busy && (
                  <Button
                    theme="outline"
                    size="small"
                    disabled={state.phase === "cancelling"}
                    onClick={() => {
                      window.electron
                        .cancelWorkshopOperation()
                        .then(applyState)
                        .catch(() => setError("connection"));
                    }}
                  >
                    {t("cancel")}
                  </Button>
                )}
              </div>
              {state.logs.length > 0 && (
                <pre
                  ref={logsRef}
                  className="workshop__logs"
                  dir="ltr"
                  aria-label={t("logs")}
                >
                  {state.logs.join("\n")}
                </pre>
              )}
              {state.downloadPath && (
                <div className="workshop__saved">
                  <p>{t("saved_to")}</p>
                  <code dir="ltr">{state.downloadPath}</code>
                  <Button theme="outline" onClick={() => void openFolder()}>
                    <FolderOpen size={16} />
                    {t("open_folder")}
                  </Button>
                </div>
              )}
            </div>
          )}
          <p className="workshop__path">
            <span>{t("destination")}</span>
            <code dir="ltr">{state.contentPath}</code>
          </p>
        </div>
      )}
      {displayError && (
        <p role="alert" className="workshop__error">
          {t(`errors.${displayError}`)}
        </p>
      )}
    </section>
  );
}
