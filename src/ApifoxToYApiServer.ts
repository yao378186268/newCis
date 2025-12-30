import getAvailablePort from "get-port";
import http from "http";
import onExit from "signal-exit";
import url from "url";
import type { AsyncReturnType } from "./vutils/type";
import isEmpty from "lodash/isEmpty";
import { swaggerJsonToYApiData } from "./swaggerJsonToYApiData";
import { fetchApifoxOpenAPI, type ApifoxConfig } from "./utils/apifox";
import { OpenAPIV3 } from "openapi-types";

export interface ApifoxToYApiServerOptions {
  serverUrl: string;
  token: string;
  projectId: string; // 改为必需参数
}

export class ApifoxToYApiServer {
  private port = 0;

  private openApiData: OpenAPIV3.Document = {} as any;

  private httpServer: http.Server | null = null;

  private yapiData: AsyncReturnType<typeof swaggerJsonToYApiData> = {} as any;

  constructor(private readonly options: ApifoxToYApiServerOptions) {}

  async getPort(): Promise<number> {
    if (this.port === 0) {
      this.port = await getAvailablePort({
        port: 50506, // 使用不同的端口避免冲突
      });
    }
    return this.port;
  }

  async getUrl(): Promise<string> {
    return `http://127.0.0.1:${await this.getPort()}`;
  }

  async getOpenApiData(): Promise<OpenAPIV3.Document> {
    if (isEmpty(this.openApiData)) {
      const config: ApifoxConfig = {
        serverUrl: this.options.serverUrl,
        token: this.options.token,
        projectId: this.options.projectId,
      };
      this.openApiData = await fetchApifoxOpenAPI(config);
    }
    return this.openApiData;
  }

  async getYApiData(): Promise<AsyncReturnType<typeof swaggerJsonToYApiData>> {
    if (isEmpty(this.yapiData)) {
      this.yapiData = await swaggerJsonToYApiData(await this.getOpenApiData());
    }
    return this.yapiData;
  }

  async start(): Promise<string> {
    const yapiData = await this.getYApiData();
    // eslint-disable-next-line no-async-promise-executor
    await new Promise<void>(async (resolve) => {
      this.httpServer = http
        .createServer(async (req, res) => {
          const { pathname } = url.parse(req.url || "");
          res.setHeader("Content-Type", "application/json");
          if (pathname!.includes("/api/plugin/export")) {
            res.end(
              JSON.stringify(
                yapiData.cats.map((cat) => ({
                  ...cat,
                  list: yapiData.interfaces.filter(
                    (item) => item.catid === cat._id
                  ),
                }))
              )
            );
          } else if (pathname!.includes("/api/interface/getCatMenu")) {
            res.end(
              JSON.stringify({
                errcode: 0,
                errmsg: "成功！",
                data: yapiData.cats,
              })
            );
          } else if (pathname!.includes("/api/project/get")) {
            res.end(
              JSON.stringify({
                errcode: 0,
                errmsg: "成功！",
                data: yapiData.project,
              })
            );
          } else {
            res.end("404");
          }
        })
        .listen(await this.getPort(), "127.0.0.1", () => {
          onExit(() => this.stop());
          resolve();
        });
    });
    return this.getUrl();
  }

  async stop(): Promise<void> {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
  }
}
