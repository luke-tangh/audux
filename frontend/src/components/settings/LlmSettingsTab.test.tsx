import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../i18n/LocaleProvider";
import LlmSettingsTab from "./LlmSettingsTab";

function renderTab(overrides: Partial<ComponentProps<typeof LlmSettingsTab>> = {}) {
  const callbacks = {
    onLlmEndpointChange: vi.fn(),
    onLlmModelChange: vi.fn(),
    onLlmApiKeyChange: vi.fn(),
    onLlmTimeoutChange: vi.fn(),
    onLlmMaxTokensChange: vi.fn(),
    onLlmTemperatureChange: vi.fn(),
    onLlmAllowRemoteEndpointChange: vi.fn(),
    onAiOutputLanguageChange: vi.fn(),
    onDiscoverLlmModels: vi.fn().mockResolvedValue(["model-a", "model-b"]),
    onSaveLlm: vi.fn(),
    onTestLlm: vi.fn()
  };

  render(
    <LocaleProvider>
      <LlmSettingsTab
        llmEndpoint="http://127.0.0.1:1234/v1"
        llmModel=""
        llmApiKey=""
        llmTimeout="60"
        llmMaxTokens="800"
        llmTemperature="0.2"
        llmAllowRemoteEndpoint={false}
        aiOutputLanguage="auto"
        llmWarning={null}
        llmTestResult=""
        {...callbacks}
        {...overrides}
      />
    </LocaleProvider>
  );

  return callbacks;
}

describe("LLM service and model selection", () => {
  it("reveals advanced fields below their checkbox", () => {
    renderTab();

    const toggle = screen.getByRole("checkbox", {
      name: /显示高级设置|Show advanced settings/
    });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    const timeout = screen.getByLabelText(/超时秒数|Timeout/);
    expect(timeout).toHaveValue("60");
    expect(
      toggle.compareDocumentPosition(timeout) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /选择本地模型服务|Choose a local model service/ })
    ).toBeInTheDocument();
  });

  it("keeps service presets visible for custom services and does not insert model defaults", () => {
    const callbacks = renderTab();

    fireEvent.click(
      screen.getByRole("button", { name: /自定义服务|Custom service/ })
    );
    expect(
      screen.getByRole("heading", { name: /选择本地模型服务|Choose a local model service/ })
    ).toBeInTheDocument();
    expect(callbacks.onLlmModelChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Ollama/ }));
    expect(callbacks.onLlmEndpointChange).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/v1"
    );
    expect(callbacks.onLlmModelChange).toHaveBeenCalledWith("");
  });

  it("fetches endpoint models and lets the user choose one", async () => {
    const callbacks = renderTab();

    const fetchModels = screen.getByRole("button", {
      name: /从 Endpoint 获取模型|Fetch models from endpoint/
    });
    const testConnection = screen.getByRole("button", {
      name: /测试连接|Test connection/
    });
    expect(fetchModels.parentElement).toBe(testConnection.parentElement);
    fireEvent.click(fetchModels);

    await waitFor(() => expect(callbacks.onDiscoverLlmModels).toHaveBeenCalledOnce());
    expect(
      await screen.findByText(/已获取 2 个模型|Found 2 models/)
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("combobox", {
        name: /Endpoint 可用模型|Models available from endpoint/
      })
    );
    fireEvent.click(screen.getByRole("option", { name: "model-b" }));
    expect(callbacks.onLlmModelChange).toHaveBeenCalledWith("model-b");
  });
});
