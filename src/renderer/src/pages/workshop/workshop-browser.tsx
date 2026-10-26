import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import {
  Check,
  Download,
  FolderOpen,
  Package,
  RefreshCw,
  Search,
  Share2,
  X,
} from "lucide-react";
import {
  Button,
  ConfirmationModal,
  Modal,
  TextField,
} from "@renderer/components";
import type {
  WorkshopBrowseResult,
  WorkshopCatalogueItem,
  WorkshopLibraryState,
  WorkshopMod,
  WorkshopPack,
  WorkshopState,
} from "@types";
import "./workshop-browser.scss";

const EMPTY: WorkshopLibraryState = {
  revision: 0,
  mods: [],
  activeId: null,
  targets: {},
};
const operationError = (error: unknown, fallback = "operation-failed") =>
  error instanceof Error
    ? (error.message.match(/([a-z]+(?:-[a-z]+)+)$/)?.[1] ?? fallback)
    : fallback;
const ready = (mod?: WorkshopMod) =>
  mod && ["downloaded", "installed"].includes(mod.status);
const sizeLabel = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

export default function WorkshopBrowser() {
  const { t } = useTranslation("workshop");
  const [params, setParams] = useSearchParams();
  const appId = /^[1-9]\d{0,9}$/.test(params.get("appId") ?? "")
    ? params.get("appId")!
    : "";
  const packLink = params.get("pack") ?? "";
  const [games, setGames] = useState<{ appId: string; name: string }[]>([]);
  const [library, setLibrary] = useState(EMPTY);
  const [runtime, setRuntime] = useState<WorkshopState | null>(null);
  const [catalogue, setCatalogue] = useState<WorkshopBrowseResult>({
    items: [],
    total: 0,
    page: 1,
    hasMore: false,
  });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState("trend");
  const [localOnly, setLocalOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importLink, setImportLink] = useState(packLink);
  const [imported, setImported] = useState<{
    pack: WorkshopPack;
    items: WorkshopCatalogueItem[];
  } | null>(null);
  const [shared, setShared] = useState("");
  const [removeItem, setRemoveItem] = useState<WorkshopCatalogueItem | null>(
    null
  );
  const [manualId, setManualId] = useState("");
  const [itemLink, setItemLink] = useState("");
  const generation = useRef(0);
  const name =
    games.find((game) => game.appId === appId)?.name ||
    params.get("title") ||
    `Steam App ${appId}`;
  const applyLibrary = useCallback(
    (state: WorkshopLibraryState) =>
      setLibrary((previous) =>
        state.revision >= previous.revision ? state : previous
      ),
    []
  );
  const applyRuntime = useCallback(
    (state: WorkshopState) =>
      setRuntime((previous) =>
        !previous || state.revision >= previous.revision ? state : previous
      ),
    []
  );
  const run = async (action: () => Promise<unknown>) => {
    setError("");
    setWorking(true);
    try {
      await action();
    } catch (e) {
      setError(operationError(e));
    } finally {
      setWorking(false);
    }
  };
  useEffect(() => {
    let mounted = true;
    const unsubscribe = window.electron.onWorkshopLibraryChanged((state) => {
      if (mounted) applyLibrary(state);
    });
    const stop = window.electron.onWorkshopStateChanged((state) => {
      if (mounted) applyRuntime(state);
    });
    Promise.all([
      window.electron.getWorkshopLibrary(),
      window.electron.getWorkshopState(),
      window.electron.getWorkshopGames(),
    ])
      .then(([state, operation, options]) => {
        if (!mounted) return;
        applyLibrary(state);
        applyRuntime(operation);
        setGames(options);
      })
      .catch(() => {
        if (mounted) setError("library-unavailable");
      });
    return () => {
      mounted = false;
      unsubscribe();
      stop();
    };
  }, [applyLibrary, applyRuntime]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 450);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setSelected(new Set());
    setSearch("");
    setDebouncedSearch("");
    setLocalOnly(false);
  }, [appId]);
  const load = useCallback(
    async (page = 1) => {
      if (!appId) return;
      const current = ++generation.current;
      setLoading(true);
      setError("");
      try {
        const result = await window.electron.browseWorkshop({
          appId,
          search: debouncedSearch,
          page,
          sort,
        });
        if (current !== generation.current) return;
        setCatalogue((previous) => ({
          ...result,
          items:
            page === 1
              ? result.items
              : [
                  ...new Map(
                    [...previous.items, ...result.items].map((item) => [
                      item.id,
                      item,
                    ])
                  ).values(),
                ],
        }));
      } catch (e) {
        if (current === generation.current)
          setError(operationError(e, "catalogue-unavailable"));
      } finally {
        if (current === generation.current) setLoading(false);
      }
    },
    [appId, debouncedSearch, sort]
  );
  const invalidateBrowse = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    setCatalogue({ items: [], total: 0, page: 1, hasMore: false });
    void load();
    return invalidateBrowse;
  }, [load, invalidateBrowse]);
  useEffect(() => {
    if (!packLink) return;
    let current = true;
    setImportLink(packLink);
    window.electron
      .inspectWorkshopPack(packLink)
      .then((result) => {
        if (current) setImported(result);
      })
      .catch(() => {
        if (current) setError("invalid-pack");
      });
    return () => {
      current = false;
    };
  }, [packLink]);
  const local = useMemo(
    () => library.mods.filter((mod) => mod.item.appId === appId),
    [library.mods, appId]
  );
  const records = new Map(local.map((mod) => [mod.item.id, mod]));
  const items = localOnly
    ? local
        .filter(
          (mod) =>
            ready(mod) &&
            `${mod.item.title} ${mod.item.description}`
              .toLowerCase()
              .includes(search.toLowerCase())
        )
        .map((mod) => mod.item)
    : catalogue.items;
  const queue = library.mods.filter((mod) =>
    ["queued", "downloading"].includes(mod.status)
  );
  const active = library.mods.find((mod) => mod.status === "downloading");
  const enqueue = (ids: string[], targetApp = appId) =>
    run(async () =>
      applyLibrary(await window.electron.enqueueWorkshopItems(targetApp, ids))
    );
  const switchGame = (next: string, title?: string) =>
    setParams({ appId: next, ...(title ? { title } : {}) });
  const clearImport = () => {
    setImported(null);
    if (packLink) {
      const next = new URLSearchParams(params);
      next.delete("pack");
      setParams(next, { replace: true });
    }
  };
  return (
    <section className="workshop-browser">
      <header className="workshop-browser__header">
        <div>
          <span className="workshop-browser__eyebrow">Workshop</span>
          <h1>
            {appId ? t("browser_title", { game: name }) : t("choose_game")}
          </h1>
          <p>{t("browser_description")}</p>
        </div>
        <Package size={42} />
      </header>
      <div className="workshop-browser__tools">
        <details open={!appId}>
          <summary>{t("game_label")}</summary>
          <div className="workshop-browser__game-picker">
            <label>
              {t("game_label")}
              <select
                value={games.some((game) => game.appId === appId) ? appId : ""}
                onChange={(event) => switchGame(event.target.value)}
              >
                <option value="">{t("choose_game")}</option>
                {games.map((game) => (
                  <option key={game.appId} value={game.appId}>
                    {game.name}
                  </option>
                ))}
              </select>
            </label>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (/^[1-9]\d{0,9}$/.test(manualId)) switchGame(manualId);
              }}
            >
              <TextField
                label={t("steam_app_id")}
                value={manualId}
                onChange={(event) => setManualId(event.target.value)}
                placeholder={appId || "5053820"}
                maxLength={10}
              />
              <Button
                type="submit"
                theme="outline"
                disabled={!/^[1-9]\d{0,9}$/.test(manualId)}
              >
                {t("browse_game")}
              </Button>
            </form>
          </div>
        </details>
        <details>
          <summary>{t("import_pack")}</summary>
          <form
            className="workshop-browser__import"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const result =
                  await window.electron.inspectWorkshopPack(importLink);
                setImported(result);
                switchGame(result.pack.appId);
              });
            }}
          >
            <TextField
              label={t("pack_link_label")}
              value={importLink}
              onChange={(event) => setImportLink(event.target.value)}
              placeholder="hydralauncher-workshop://workshop?v=1&appId=…&items=…"
              maxLength={5000}
            />
            <Button
              type="submit"
              theme="outline"
              disabled={!importLink.trim() || working}
            >
              {t("import_pack")}
            </Button>
          </form>
        </details>
      </div>
      {queue.length > 0 && (
        <div className="workshop-browser__queue" role="status">
          <Download size={20} />
          <div>
            <strong>{t("queue_count", { count: queue.length })}</strong>
            <p>
              {active?.item.title}{" "}
              {runtime?.busy ? `— ${t(`phase.${runtime.phase}`)}` : ""}
            </p>
          </div>
          <Button
            theme="outline"
            onClick={() =>
              void run(async () =>
                applyLibrary(await window.electron.cancelWorkshopQueue())
              )
            }
          >
            <X size={16} />
            {t("cancel_queue")}
          </Button>
        </div>
      )}
      {appId && (
        <>
          <div className="workshop-browser__toolbar">
            <div className="workshop-browser__search">
              <Search size={18} />
              <input
                aria-label={t("search_items")}
                placeholder={t("search_items")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <select
              aria-label={t("sort_items")}
              value={sort}
              disabled={localOnly}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="trend">{t("sort_popular")}</option>
              <option value="mostrecent">{t("sort_newest")}</option>
              <option value="totaluniquesubscribers">
                {t("sort_subscribed")}
              </option>
            </select>
            <Button
              theme={localOnly ? "primary" : "outline"}
              onClick={() => setLocalOnly((value) => !value)}
            >
              <Check size={16} />
              {t("my_mods")}
            </Button>
            <Button
              theme="outline"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw size={16} />
              {t("refresh")}
            </Button>
          </div>
          <div className="workshop-browser__settings">
            <p>
              {library.targets[appId]
                ? t("copy_target", { path: library.targets[appId] })
                : t("download_target_hint")}
            </p>
            <Button
              theme="outline"
              size="small"
              onClick={() =>
                void run(async () =>
                  applyLibrary(
                    await window.electron.chooseWorkshopTarget(appId)
                  )
                )
              }
            >
              <FolderOpen size={16} />
              {t("choose_target")}
            </Button>
            <Button
              theme="outline"
              size="small"
              disabled={working}
              onClick={() =>
                void run(async () =>
                  applyLibrary(
                    await window.electron.importLocalWorkshopMods(appId)
                  )
                )
              }
            >
              {t("import_local")}
            </Button>
          </div>
          {selected.size > 0 && (
            <div className="workshop-browser__selection">
              <strong>{t("selected_count", { count: selected.size })}</strong>
              <Button
                onClick={() =>
                  void run(async () =>
                    setShared(
                      await window.electron.shareWorkshopPack(appId, [
                        ...selected,
                      ])
                    )
                  )
                }
                disabled={working}
              >
                <Share2 size={17} />
                {t("share_selected")}
              </Button>
              <Button theme="outline" onClick={() => setSelected(new Set())}>
                {t("clear_selection")}
              </Button>
            </div>
          )}
          {loading && !items.length && (
            <p role="status">{t("loading_items")}</p>
          )}
          {!loading && !items.length && (
            <div className="workshop-browser__empty">
              <Package size={40} />
              <h2>{t(localOnly ? "no_downloaded" : "no_items")}</h2>
              <p>{t(localOnly ? "no_downloaded_hint" : "no_items_hint")}</p>
            </div>
          )}
          <div className="workshop-browser__grid">
            {items.map((item) => {
              const mod = records.get(item.id);
              const available = !!ready(mod);
              const inQueue =
                mod && ["queued", "downloading"].includes(mod.status);
              const canInstall =
                !inQueue &&
                mod?.status !== "installed" &&
                !(mod?.status === "downloaded" && !library.targets[appId]);
              return (
                <article
                  key={item.id}
                  className={`workshop-browser__card ${selected.has(item.id) ? "workshop-browser__card--selected" : ""}`}
                >
                  <div className="workshop-browser__art">
                    {item.previewUrl ? (
                      <img
                        src={item.previewUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <Package size={40} />
                    )}{" "}
                    {available && (
                      <label className="workshop-browser__check">
                        <input
                          type="checkbox"
                          aria-label={t("select_mod", { title: item.title })}
                          checked={selected.has(item.id)}
                          onChange={(event) =>
                            setSelected((previous) => {
                              const next = new Set(previous);
                              if (event.target.checked) next.add(item.id);
                              else next.delete(item.id);
                              return next;
                            })
                          }
                        />
                        {t("select")}
                      </label>
                    )}
                  </div>
                  <h2>{item.title}</h2>
                  <p className="workshop-browser__description">
                    {item.description}
                  </p>
                  <p className="workshop-browser__meta">
                    ID: {item.id} · {sizeLabel(item.size)}
                  </p>
                  {mod && (
                    <p
                      className={`workshop-browser__status workshop-browser__status--${mod.status}`}
                    >
                      {t(`mod_status.${mod.status}`)}
                    </p>
                  )}
                  {mod?.error && (
                    <p className="workshop-browser__item-error">
                      {t(`library_errors.${mod.error}`, {
                        defaultValue: t("library_errors.operation-failed"),
                      })}
                    </p>
                  )}
                  <div className="workshop-browser__card-actions">
                    <Button
                      className="workshop-browser__install"
                      disabled={
                        !canInstall || working || runtime?.supported === false
                      }
                      onClick={() => void enqueue([item.id])}
                    >
                      <Download size={16} />
                      {t(
                        inQueue
                          ? "queued"
                          : available && !canInstall
                            ? "mod_status." + mod!.status
                            : "install_item"
                      )}
                    </Button>
                    <Button
                      theme="outline"
                      disabled={!mod || !!inQueue || working}
                      onClick={() => setRemoveItem(item)}
                    >
                      {t("remove_item")}
                    </Button>
                  </div>
                  <Button
                    theme="outline"
                    disabled={!available}
                    onClick={() =>
                      void run(async () => {
                        if (
                          await window.electron.openWorkshopItemFolder(
                            appId,
                            item.id
                          )
                        )
                          throw new Error("folder");
                      })
                    }
                  >
                    <FolderOpen size={16} />
                    {t("open_folder")}
                  </Button>
                </article>
              );
            })}
          </div>
          <footer className="workshop-browser__footer">
            <p>
              {t("items_count", {
                shown: items.length,
                total: localOnly ? items.length : catalogue.total,
              })}
            </p>
            {!localOnly && catalogue.hasMore && (
              <Button
                theme="outline"
                disabled={loading}
                onClick={() => void load(catalogue.page + 1)}
              >
                {t(loading ? "loading_items" : "show_more")}
              </Button>
            )}
          </footer>
          <form
            className="workshop-browser__import"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const result =
                  await window.electron.inspectWorkshopItem(itemLink);
                if (!result) throw new Error("invalid-item");
                applyLibrary(
                  await window.electron.enqueueWorkshopItems(
                    result.item.appId,
                    [result.item.id]
                  )
                );
                switchGame(result.item.appId);
              });
            }}
          >
            <TextField
              label={t("item_link_label")}
              value={itemLink}
              onChange={(event) => setItemLink(event.target.value)}
              placeholder="https://steamcommunity.com/sharedfiles/filedetails/?id=…"
            />
            <Button
              type="submit"
              theme="outline"
              disabled={!itemLink.trim() || working}
            >
              {t("install_item")}
            </Button>
          </form>
        </>
      )}
      {error && (
        <p role="alert" className="workshop-browser__error">
          {t(`library_errors.${error}`, {
            defaultValue: t("library_errors.operation-failed"),
          })}
        </p>
      )}
      <details className="workshop-browser__advanced">
        <summary>{t("advanced")}</summary>
        <p>{t("download_limits")}</p>
        <Link to="/workshop/download">{t("manual_download")}</Link>
        {runtime?.logs.length ? (
          <pre dir="ltr">{runtime.logs.join("\n")}</pre>
        ) : null}
      </details>
      <Modal
        visible={!!imported}
        title={t("import_pack_title")}
        description={t("import_pack_hint")}
        onClose={clearImport}
      >
        {imported && (
          <div className="workshop-browser__pack">
            <p>
              Steam App {imported.pack.appId} ·{" "}
              {t("selected_count", { count: imported.items.length })}
            </p>
            <ul>
              {imported.items.map((item) => (
                <li key={item.id}>
                  {item.title} <small>({item.id})</small>
                </li>
              ))}
            </ul>
            <Button
              disabled={working}
              onClick={() =>
                void run(async () => {
                  applyLibrary(
                    await window.electron.enqueueWorkshopItems(
                      imported.pack.appId,
                      imported.pack.itemIds
                    )
                  );
                  switchGame(imported.pack.appId);
                  setImported(null);
                })
              }
            >
              <Download size={18} />
              {t("install_pack")}
            </Button>
          </div>
        )}
      </Modal>
      <Modal
        visible={!!shared}
        title={t("share_pack_title")}
        description={t("share_pack_hint")}
        onClose={() => setShared("")}
      >
        <div className="workshop-browser__pack">
          <textarea
            aria-label={t("share_pack_title")}
            value={shared}
            readOnly
            rows={5}
            dir="ltr"
            onFocus={(event) => event.currentTarget.select()}
          />
          <p>{t("share_pack_privacy")}</p>
        </div>
      </Modal>
      <ConfirmationModal
        visible={!!removeItem}
        title={t("remove_item")}
        descriptionText={t("remove_confirm", { title: removeItem?.title })}
        confirmButtonLabel={t("remove_item")}
        cancelButtonLabel={t("cancel")}
        onClose={() => setRemoveItem(null)}
        onConfirm={() => {
          const item = removeItem;
          setRemoveItem(null);
          if (item)
            void run(async () => {
              applyLibrary(
                await window.electron.removeWorkshopItem(item.appId, item.id)
              );
              setSelected((previous) => {
                const next = new Set(previous);
                next.delete(item.id);
                return next;
              });
            });
        }}
      />
    </section>
  );
}
