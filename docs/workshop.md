# Hydra Workshop

Community fork of [Hydra Launcher](https://github.com/hydralauncher/hydra) with a Steam Workshop downloader. This is an independent project.

## Use

Each game details page has a **Workshop** button immediately after **Play** (or the game's current action). It opens the **internal Workshop browser** for the current Steam catalogue identity, including linked non-Steam entries. The button is disabled if no Steam identity is known. Games without Workshop support show an empty catalogue.

1. Select **Workshop** on a game's page, or open the sidebar page and choose a game from Hydra / installed Steam libraries. Any valid Steam App ID can also be entered.
2. Browse cards with Steam previews, descriptions and sizes. Search, sort, refresh and load additional pages inside Hydra.
3. Select **Install**. The item is queued immediately. If needed, Hydra downloads Valve's SteamCMD bootstrap and initializes it automatically. Multiple items download sequentially; progress and logs remain available when changing pages.
4. Files are marked **Downloaded** after SteamCMD confirms success. Optionally select the game's known **Local mod folder** once: completed items are copied into numbered subfolders and marked **Copied to mod folder**. Selecting a folder does not change the game's load order or guarantee that its engine loads those files.
5. Use **My mods** to filter completed items. **Add existing mods** accepts a local Workshop root containing numeric item-ID directories, verifies their game against Steam metadata and adds them for sharing. Original imported files are never deleted by Hydra.
6. Select completed mods and choose **Share selected**. The copied `hydralauncher-workshop://workshop?v=1&appId=…&items=…` link contains only a game ID and up to 100 item IDs. The recipient needs this fork, can open the link or paste it into **Import pack**, review its contents and choose **Install all mods**. No server or account is required for sharing the list; each recipient still needs download access to the items.

The advanced section retains the manual individual-item URL downloader. Collections are not mod-pack links and remain unsupported.

The interface is translated into English and Arabic. Other Hydra languages fall back to English for this page.

## Behavior and limits

- Windows only in this first version.
- Uses `+login anonymous +workshop_download_item <appId> <itemId> validate +quit`.
- Some games restrict Workshop downloads to signed-in accounts that own the game. This version does not sign in to Steam or bypass those restrictions.
- The catalogue reads Valve's public Steam Community server-rendered query data, without executing page scripts, browser automation or a Steam Web API key. The parser may need updating if Valve changes the page format. Item/game identities are verified again using Steam's published-file metadata before queuing a pack.
- Downloaded-mod records, queue outcomes and selected destinations survive restart in `<userData>/workshop/library.json`. Interrupted jobs become cancelled and can be retried. They do not resume automatically on startup.
- Identification uses Steam's `consumer_app_id`, never the mod's filename, title, or creator app ID. It works for public individual items whose Steam metadata is available, including games absent from your library. Game names fall back to Steam App ID if name lookup fails.
- The game is matched against non-deleted Hydra entries by Steam ID or an explicit Steam catalogue link. The launcher also reads installed Steam manifests to locate the game. Hydra executable locations are validated and labelled as executable folders, since they can be nested below the game's root. No filename or title guesses are used.
- Downloads are grouped by `<appId>/<itemId>`. Optional copies use a destination chosen in the native folder picker. Hydra refuses symbolic links/junctions and foreign existing item folders; it only removes managed copies and cached downloads, using the Recycle Bin. Game-specific activation, dependencies and load order remain manual. No automatic Mimic Party activation adapter is claimed.
- Files live in `<userData>/workshop/steamcmd/steamapps/workshop/content/<appId>/<itemId>/`.
- The fork has its own app name, application ID, data directory, `hydralauncher-workshop` launch protocol and update feed. It does not migrate the original Hydra library.
- One Workshop operation runs at a time. Changing pages does not stop it. Reopening the page restores its state and recent output. Exiting the launcher cancels the active process; unfinished files are preserved for SteamCMD to validate on retry.
- Success requires SteamCMD's explicit success message for the requested item and a nonempty content directory. A completion receipt is written only then. A partial directory is not reused as a successful download. Exit code zero alone is insufficient.
- SteamCMD is downloaded on demand, not redistributed in this repository.

## Develop and verify

Follow the upstream build prerequisites, including Node, Yarn, Windows C++ build tools and Rust for Hydra's native addon. Configure the upstream public API environment values if other Hydra services are needed. Workshop calls Valve directly and needs no Hydra API credentials.

```sh
yarn install
yarn test:workshop
yarn typecheck
yarn build
yarn dev
```

`test:workshop` covers process lifecycle, game matching, hostile item/pack links, catalogue parsing without script execution, consumer-game isolation, destination ownership, traversal and symlink/junction rejection. Integration checks additionally exercised live catalogue search/paging, sequential Harmony and HugsLib downloads, copying to an isolated test folder, persistent records, pack sharing/import and honest reporting when Steam refused a Mimic Party download.

## Credits

Hydra remains licensed under the MIT License; see the root LICENSE. The feature's workflow was informed by Ascendara's MIT-licensed Workshop downloader. This implementation uses Hydra's own components, IPC bridge and archive extraction.

- [Ascendara source](https://github.com/Ascendara/ascendara/blob/main/electron/modules/system/steamcmd.js)
- [Valve SteamCMD documentation](https://developer.valvesoftware.com/wiki/SteamCMD)
