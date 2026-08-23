import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function isIgnoredByViteWatcher(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");

  return (
    normalized.includes("/src-tauri/target/") ||
    normalized.endsWith("/src-tauri/target") ||
    normalized.includes("/src-tauri/.cargo/") ||
    normalized.endsWith("/src-tauri/.cargo")
  );
}

export default defineConfig({
  plugins: [react()],

  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "frontend-framework",
              test: /node_modules[\\/](?:i18next|react|react-dom|react-i18next|scheduler|use-sync-external-store)[\\/]/
            }
          ]
        }
      }
    }
  },

  // 保留 Rust / Python 后端日志，不要被 Vite 清屏
  clearScreen: false,

  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,

    watch: {
      // 关键：不要让 Vite 监听 Rust 编译产物，否则 Windows 下容易 EBUSY
      ignored: isIgnoredByViteWatcher
    }
  }
});
