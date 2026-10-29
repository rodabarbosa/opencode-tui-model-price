/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import { createSignal, createMemo, For, Show } from "solid-js";
import { ModelPricingRpc, type PricingMatrix, type ModelPriceDetail } from "./rpc.js";
import { formatUSD } from "./pricing.js";

export default Plugin.define({
  id: "model-pricing-tui",
  setup(context) {
    const pricingRpc = context.client.rpc(ModelPricingRpc);

    // Armazenamento durável de modelos favoritos (persiste no disco e entre reinicializações)
    const [favoritesStore, updateFavorites] = context.storage.store("favorites", {
      initial: { ids: [] as string[] },
    });

    // Substitui o comando built-in model.list por esta versão enriquecida com preços e favoritos
    context.keymap.layer(() => ({
      mode: "global",
      priority: 100,
      commands: [
        {
          id: "model.list",
          title: "Modelos: Selecionar com detalhes de preços",
          group: "Modelos",
          slash: { name: "models" },
          palette: true,
          suggested: true,
          run: async () => {
            await openPricingModelDialog();
          },
        },
        {
          id: "model.pricing.refresh",
          title: "Modelos: Forçar atualização dos preços de tokens",
          group: "Modelos",
          slash: { name: "update-model-prices" },
          palette: true,
          run: async () => {
            try {
              context.ui.toast.show({
                title: "Preços",
                message: "Atualizando tabela de preços...",
                variant: "info",
              });
              const res = await pricingRpc.forceRefresh();
              context.ui.toast.show({
                title: "Preços Atualizados",
                message: `${res.count} modelos sincronizados com sucesso.`,
                variant: "success",
              });
            } catch (err: any) {
              context.ui.toast.show({
                title: "Erro na Atualização",
                message: err?.message || "Falha ao sincronizar preços.",
                variant: "danger",
              });
            }
          },
        },
      ],
    }));

    async function openPricingModelDialog() {
      let modelsList: any[] = [];
      try {
        const location = context.location ?? context.data.location.default();
        modelsList = (await context.client.model.list({ location }))?.data ?? [];
      } catch {
        modelsList = context.data.location.model.list() ?? [];
      }

      if (modelsList.length === 0) {
        context.ui.toast.show({
          title: "Modelos",
          message: "Nenhum modelo disponível encontrado.",
          variant: "warning",
        });
        return;
      }

      let initialPrices: PricingMatrix = {};
      try {
        initialPrices = (await pricingRpc.getPrices()) as PricingMatrix;
      } catch {
        // Fallback vazio
      }

      const activeSessionID = context.data.session.list()?.[0]?.id;

      context.ui.dialog.set({ size: "xlarge", centered: true });

      context.ui.dialog.show(() => {
        context.ui.dialog.set({ size: "xlarge", centered: true });

        const [selectedIndex, setSelectedIndex] = createSignal(0);
        const [prices, setPrices] = createSignal<PricingMatrix>(initialPrices);
        const [isRefreshing, setIsRefreshing] = createSignal(false);

        const theme = () => {
          try {
            return (context.theme as any).surface?.("dialog") || context.theme;
          } catch {
            return context.theme;
          }
        };

        const close = () => context.ui.dialog.clear();

        // Verifica se um modelo está nos favoritos
        const isFavorite = (id?: string) => {
          if (!id) return false;
          const list = favoritesStore.ids || [];
          return list.includes(id.toLowerCase());
        };

        // Ordena os modelos colocando os favoritos no topo
        const models = createMemo(() => {
          const favs: any[] = [];
          const others: any[] = [];
          for (const m of modelsList) {
            if (isFavorite(m.id)) {
              favs.push(m);
            } else {
              others.push(m);
            }
          }
          return [...favs, ...others];
        });

        const currentModel = createMemo(() => {
          const list = models();
          const idx = selectedIndex();
          return list[idx] || list[0];
        });

        const currentPrice = createMemo((): ModelPriceDetail => {
          const m = currentModel();
          if (!m) {
            return {
              inputPerMillion: 0,
              outputPerMillion: 0,
              cacheReadPerMillion: 0,
              cacheWritePerMillion: 0,
            };
          }
          const dict = prices();
          const fullId = (m.id || "").toLowerCase();
          const shortId = (m.modelID || fullId.split("/")[1] || fullId).toLowerCase();

          return (
            dict[fullId] ||
            dict[shortId] ||
            dict[m.id] || {
              inputPerMillion: m.cost?.[0]?.input ?? 0,
              outputPerMillion: m.cost?.[0]?.output ?? 0,
              cacheReadPerMillion: m.cost?.[0]?.cache?.read ?? 0,
              cacheWritePerMillion: m.cost?.[0]?.cache?.write ?? 0,
              contextLimit: m.limit?.context,
              outputLimit: m.limit?.output,
            }
          );
        });

        const VISIBLE_COUNT = 13;
        const visibleRange = createMemo(() => {
          const total = models().length;
          const current = selectedIndex();
          let start = Math.max(0, current - Math.floor(VISIBLE_COUNT / 2));
          if (start + VISIBLE_COUNT > total) {
            start = Math.max(0, total - VISIBLE_COUNT);
          }
          return {
            start,
            end: Math.min(total, start + VISIBLE_COUNT),
          };
        });

        const visibleModels = createMemo(() => {
          const { start, end } = visibleRange();
          return models().slice(start, end);
        });

        const selectCurrentModel = async () => {
          const m = currentModel();
          if (!m) return;

          if (activeSessionID) {
            try {
              await context.client.session.switchModel({
                sessionID: activeSessionID,
                model: { providerID: m.providerID, id: m.id },
              });
              context.ui.toast.show({
                title: "Modelo Ativo Alterado",
                message: `${m.name || m.id} (${m.providerID})`,
                variant: "success",
              });
            } catch (err: any) {
              context.ui.toast.show({
                title: "Erro ao trocar modelo",
                message: err?.message || "Falha ao acionar switchModel",
                variant: "danger",
              });
            }
          } else {
            context.ui.toast.show({
              title: "Modelo Selecionado",
              message: `${m.name || m.id}`,
              variant: "info",
            });
          }
          close();
        };

        // Alterna status de favorito (Ctrl+F)
        const toggleFavorite = async () => {
          const m = currentModel();
          if (!m) return;
          const id = (m.id || "").toLowerCase();

          await updateFavorites((draft) => {
            if (!draft.ids) draft.ids = [];
            const idx = draft.ids.indexOf(id);
            if (idx >= 0) {
              draft.ids.splice(idx, 1);
              context.ui.toast.show({
                title: "Favoritos",
                message: `Removido dos favoritos: ${m.name || m.id}`,
                variant: "info",
              });
            } else {
              draft.ids.push(id);
              context.ui.toast.show({
                title: "Favoritos",
                message: `★ Marcado como favorito: ${m.name || m.id}`,
                variant: "success",
              });
            }
          });
        };

        const handleForceRefresh = async () => {
          if (isRefreshing()) return;
          setIsRefreshing(true);
          try {
            const res = await pricingRpc.forceRefresh();
            const fresh = (await pricingRpc.getPrices()) as PricingMatrix;
            setPrices(fresh);
            context.ui.toast.show({
              title: "Preços Sincronizados",
              message: `${res.count} modelos atualizados.`,
              variant: "success",
            });
          } catch (e: any) {
            context.ui.toast.show({
              title: "Erro ao sincronizar",
              message: e?.message || "Falha de rede.",
              variant: "danger",
            });
          } finally {
            setIsRefreshing(false);
          }
        };

        context.keymap.layer(() => ({
          mode: "modal",
          commands: [
            {
              bind: "down,j",
              title: "Avançar",
              group: "Navegação",
              run: () => setSelectedIndex((i) => Math.min(i + 1, models().length - 1)),
            },
            {
              bind: "up,k",
              title: "Recuar",
              group: "Navegação",
              run: () => setSelectedIndex((i) => Math.max(i - 1, 0)),
            },
            {
              bind: "pagedown",
              title: "Página Abaixo",
              group: "Navegação",
              run: () => setSelectedIndex((i) => Math.min(i + 6, models().length - 1)),
            },
            {
              bind: "pageup",
              title: "Página Acima",
              group: "Navegação",
              run: () => setSelectedIndex((i) => Math.max(i - 6, 0)),
            },
            {
              bind: "return",
              title: "Confirmar Seleção",
              group: "Ação",
              run: selectCurrentModel,
            },
            {
              bind: "ctrl+f",
              title: "Favoritar",
              group: "Ação",
              run: toggleFavorite,
            },
            {
              bind: "ctrl+r",
              title: "Forçar Atualização",
              group: "Ação",
              run: handleForceRefresh,
            },
            {
              bind: "escape",
              title: "Fechar",
              group: "Ação",
              run: close,
            },
          ],
        }));

        return (
          <box flexDirection="column" paddingLeft={1} paddingRight={1} gap={1}>
            {/* Cabeçalho */}
            <box flexDirection="row" justifyContent="space-between" borderBottom={true} paddingBottom={1}>
              <text bold fg={theme().text?.base || "white"}>
                ⚡ Seleção de Modelos & Custos de Tokens
              </text>
              <box flexDirection="row" gap={1}>
                <text fg={theme().text?.muted || "gray"}>
                  [{selectedIndex() + 1}/{models().length}]
                </text>
                <text fg={theme().text?.muted || "gray"} onMouseUp={close}>
                  [Esc]
                </text>
              </box>
            </box>

            {/* Corpo Dividido Amplo: 58% para a lista e 42% para a área secundária */}
            <box flexDirection="row" gap={2}>
              {/* Coluna 1: Lista Navegável com estrelas de favorito no topo */}
              <box width="58%" flexDirection="column" borderRight={true} paddingRight={2}>
                <For each={visibleModels()}>
                  {(m, idx) => {
                    const actualIdx = () => visibleRange().start + idx();
                    const isSelected = () => actualIdx() === selectedIndex();
                    const fav = () => isFavorite(m.id);

                    return (
                      <box
                        paddingLeft={1}
                        paddingRight={1}
                        flexDirection="row"
                        justifyContent="space-between"
                        gap={2}
                        onMouseUp={() => {
                          setSelectedIndex(actualIdx());
                          selectCurrentModel();
                        }}
                      >
                        <box flexDirection="row">
                          <text
                            bold={isSelected()}
                            fg={
                              isSelected()
                                ? (theme().text?.selected || "cyan")
                                : (theme().text?.base || "white")
                            }
                            wrap="never"
                          >
                            {isSelected() ? "▶ " : "  "}
                          </text>
                          <text fg={fav() ? "yellow" : "gray"} bold={fav()} wrap="never">
                            {fav() ? "★ " : "  "}
                          </text>
                          <text
                            bold={isSelected()}
                            fg={
                              isSelected()
                                ? (theme().text?.selected || "cyan")
                                : (theme().text?.base || "white")
                            }
                            wrap="never"
                          >
                            {m.name || m.id}
                          </text>
                        </box>
                        <text fg={theme().text?.muted || "gray"} wrap="never">
                          {m.providerID || ""}
                        </text>
                      </box>
                    );
                  }}
                </For>
              </box>

              {/* Coluna 2: Área Secundária de Detalhes e Valores */}
              <box width="42%" flexDirection="column" paddingLeft={1}>
                <Show when={currentModel()}>
                  {(m) => {
                    const p = currentPrice;
                    const fav = () => isFavorite(m().id);
                    return (
                      <box flexDirection="column" gap={1}>
                        {/* Nome, Provedor e Tag de Favorito */}
                        <box flexDirection="column">
                          <box flexDirection="row" justifyContent="space-between">
                            <text bold fg={theme().text?.selected || "cyan"} wrap="never">
                              {fav() ? "★ " : ""}{m().name || m().id}
                            </text>
                            <Show when={fav()}>
                              <text bold fg="yellow" wrap="never">
                                [Favorito]
                              </text>
                            </Show>
                          </box>
                          <text fg={theme().text?.muted || "gray"} wrap="never">
                            {m().providerID} • {m().id}
                          </text>
                        </box>

                        {/* Tabela de Preços Formatada */}
                        <box
                          paddingX={1}
                          paddingY={1}
                          border={true}
                          flexDirection="column"
                        >
                          <box flexDirection="row" justifyContent="space-between">
                            <text fg={theme().text?.muted || "gray"} wrap="never">Input:</text>
                            <text bold fg={theme().text?.base || "white"} wrap="never">
                              {formatUSD(p().inputPerMillion)} / 1M
                            </text>
                          </box>

                          <box flexDirection="row" justifyContent="space-between">
                            <text fg={theme().text?.muted || "gray"} wrap="never">Output:</text>
                            <text bold fg={theme().text?.base || "white"} wrap="never">
                              {formatUSD(p().outputPerMillion)} / 1M
                            </text>
                          </box>

                          <box flexDirection="row" justifyContent="space-between">
                            <text fg={theme().text?.muted || "gray"} wrap="never">Cache Read:</text>
                            <text bold fg={theme().text?.base || "white"} wrap="never">
                              {formatUSD(p().cacheReadPerMillion)} / 1M
                            </text>
                          </box>

                          <box flexDirection="row" justifyContent="space-between">
                            <text fg={theme().text?.muted || "gray"} wrap="never">Cache Write:</text>
                            <text bold fg={theme().text?.base || "white"} wrap="never">
                              {formatUSD(p().cacheWritePerMillion)} / 1M
                            </text>
                          </box>
                        </box>

                        {/* Metadados Técnicos */}
                        <box flexDirection="column">
                          <text fg={theme().text?.muted || "gray"} wrap="never">
                            Contexto: {p().contextLimit?.toLocaleString() ?? "N/D"} tokens
                          </text>
                          <text fg={theme().text?.muted || "gray"} wrap="never">
                            Max Output: {p().outputLimit?.toLocaleString() ?? "N/D"} tokens
                          </text>
                          <text fg={theme().text?.muted || "gray"} wrap="never">
                            Origem: {p().source || "models.dev"}
                          </text>
                        </box>
                      </box>
                    );
                  }}
                </Show>
              </box>
            </box>

            {/* Rodapé com atalho Ctrl+F */}
            <box borderTop={true} paddingTop={1} flexDirection="row" justifyContent="space-between">
              <text fg={theme().text?.muted || "gray"}>
                ↑/↓ Navegar  |  Enter Escolher  |  Ctrl+F Favoritar (★)  |  Ctrl+R Atualizar
              </text>
              <Show when={isRefreshing()}>
                <text bold fg="yellow">
                  Atualizando...
                </text>
              </Show>
            </box>
          </box>
        );
      });
    }
  },
});
