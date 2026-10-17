import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { recordCall } from "./counter.js";
import { AtkError, type AtkResult, type Site } from "./types.js";

type Connection = { client: Client; tools: Awaited<ReturnType<Client["listTools"]>>["tools"] };

const connections = new Map<Site, Promise<Connection>>();

/** Her site için tek bir `okx-trade-mcp --site <site> --modules market` süreci (yalnız okuma). */
export function getMcp(site: Site): Promise<Connection> {
  let conn = connections.get(site);
  if (!conn) {
    conn = (async () => {
      const transport = new StdioClientTransport({
        command: "okx-trade-mcp",
        args: ["--site", site, "--modules", "market"],
      });
      const client = new Client({ name: `kahin-agent-${site}`, version: "0.1.0" });
      await client.connect(transport);
      const { tools } = await client.listTools();
      return { client, tools };
    })();
    conn.catch(() => connections.delete(site));
    connections.set(site, conn);
  }
  return conn;
}

/**
 * ATK MCP aracını çağırır. ATK yanıtı `{ tool, ok, data: { endpoint, requestTime, data } }`
 * biçiminde bir metin döndürür; `json` olarak bu nesnenin `data.data` kısmı verilir.
 */
export async function atkMcp(site: Site, tool: string, args: Record<string, unknown>): Promise<AtkResult> {
  const command = `mcp(${site}) ${tool} ${JSON.stringify(args)}`;
  const started = Date.now();
  try {
    const { client } = await getMcp(site);
    const res = await client.callTool({ name: tool, arguments: args });
    const content = res.content as Array<{ type: string; text?: string }>;
    const text = content.find((c) => c.type === "text")?.text ?? "";
    const parsed = JSON.parse(text);
    if (res.isError || parsed?.ok === false) {
      throw new AtkError(`MCP aracı hata döndürdü: ${text.slice(0, 300)}`, command);
    }
    recordCall({ tool, via: "mcp", site, ms: Date.now() - started, ok: true });
    return { json: parsed?.data?.data ?? parsed?.data ?? parsed, command, raw: text };
  } catch (e) {
    recordCall({ tool, via: "mcp", site, ms: Date.now() - started, ok: false });
    if (e instanceof AtkError) throw e;
    throw new AtkError(`MCP çağrısı başarısız: ${(e as Error).message}`, command);
  }
}

export async function closeAllMcp(): Promise<void> {
  for (const conn of connections.values()) {
    try {
      (await conn).client.close();
    } catch {
      /* yoksay */
    }
  }
  connections.clear();
}
