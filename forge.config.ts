import type { ForgeConfig } from "@electron-forge/shared-types";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";

const config: ForgeConfig = {
  packagerConfig: {
    name: "Commons",
    executableName: "commons",
    appBundleId: "com.commons.app",
    icon: "./build/icon",
    prune: true,
    asar: {
      unpackDir: "resources",
    },
    osxSign: {
      optionsForFile: () => ({
        entitlements: "./build/entitlements.mac.plist",
      }),
    },
    osxNotarize: process.env.APPLE_ID
      ? {
          appleId: process.env.APPLE_ID,
          appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD!,
          teamId: process.env.APPLE_TEAM_ID!,
        }
      : undefined,
    extendInfo: {
      NSDocumentsFolderUsageDescription:
        "Application requests access to the user's Documents folder.",
      NSDownloadsFolderUsageDescription:
        "Application requests access to the user's Downloads folder.",
    },
    ignore: (path: string) => {
      if (!path) return false;
      if (path === "/package.json") return false;
      if (path.startsWith("/dist")) return false;
      if (path.startsWith("/node_modules")) return false;
      if (path.startsWith("/resources")) return false;
      return true;
    },
  },
  rebuildConfig: {
    onlyModules: ["better-sqlite3"],
    force: true,
  },
  makers: [
    {
      name: "@electron-forge/maker-dmg",
      config: {
        icon: "./build/icon.icns",
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"],
    },
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "commons",
        setupIcon: "./build/icon.ico",
      },
    },
  ],
  plugins: [new AutoUnpackNativesPlugin({})],
};

export default config;
