# Hydra Workshop

Community fork of [Hydra Launcher](https://github.com/hydralauncher/hydra) with a Steam Workshop downloader. This is an independent project.

## Use

1. Open **Workshop** in the sidebar.
2. Select **Install SteamCMD**. The app downloads the Windows bootstrap archive directly from Valve and runs its first update.
3. Paste one Steam Community Workshop item URL, or its numeric published file ID.
4. Select **Send link to SteamCMD**. Live SteamCMD output appears below the form.
5. When complete, select **Open download folder**. Install the files according to the mod author's instructions.

The interface is translated into English and Arabic. Other Hydra languages fall back to English for this page.

## Behavior and limits

- Windows only in this first version.
- Uses `+login anonymous +workshop_download_item <appId> <itemId> validate +quit`.
- Some games restrict Workshop downloads to signed-in accounts that own the game. This version does not sign in to Steam or bypass those restrictions.
- Downloads individual items. Collections display a specific message asking for an individual item link.
- Mod installation, dependencies and load order remain manual.
- Files live in `<userData>/workshop/steamcmd/steamapps/workshop/content/<appId>/<itemId>/`.
- The fork has its own app name, application ID, data directory, `hydralauncher-workshop` launch protocol and update feed. It does not migrate the original Hydra library.
- One Workshop operation runs at a time. Changing pages does not stop it. Reopening the page restores its state and recent output. Exiting the launcher cancels the active process; unfinished files are preserved for SteamCMD to validate on retry.
- Success requires SteamCMD's explicit success message for the requested item and a nonempty content directory. Exit code zero alone is insufficient.
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

`test:workshop` covers hostile/invalid links, Steam metadata and collection handling, argument validation, explicit success detection, chunked process output, cancellation, timeouts, spawn failures and bootstrap exit codes. Full download smoke testing additionally requires network access to Valve and an item that permits anonymous downloads.

## Credits

Hydra remains licensed under the MIT License; see the root LICENSE. The feature's workflow was informed by Ascendara's MIT-licensed Workshop downloader. This implementation uses Hydra's own components, IPC bridge and archive extraction.

- [Ascendara source](https://github.com/Ascendara/ascendara/blob/main/electron/modules/system/steamcmd.js)
- [Valve SteamCMD documentation](https://developer.valvesoftware.com/wiki/SteamCMD)
