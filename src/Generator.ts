import * as changeCase from "change-case";
import { exec } from "child_process";
import dayjs from "dayjs";
import fs from "fs-extra";
import consola from "consola";
import castArray from "lodash/castArray";
import cloneDeep from "lodash/cloneDeep";
import groupBy from "lodash/groupBy";
import isEmpty from "lodash/isEmpty";
import isFunction from "lodash/isFunction";
import last from "lodash/last";
import memoize from "lodash/memoize";
import noop from "lodash/noop";
import omit from "lodash/omit";
import uniq from "lodash/uniq";
import values from "lodash/values";
import path from "path";
import { SwaggerToYApiServer } from "./SwaggerToYApiServer";
import { ApifoxToYApiServer } from "./ApifoxToYApiServer";
import {
  CategoryList,
  CommentConfig,
  Config,
  ExtendedInterface,
  Interface,
  InterfaceList,
  Project,
  ProjectConfig,
  ServerConfig,
  SyntheticalConfig,
} from "./types";
import {
  getCachedPrettierOptions,
  getNormalizedPathWithAlias,
  getOutputFilePath,
  getPrettier,
  getReponseDataTypeName,
  getRequestDataJsonSchema,
  getRequestDataTypeName,
  getRequestFunctionName,
  getResponseDataJsonSchema,
  httpGet,
  jsonSchemaToType,
  sortByWeights,
  throwError,
  transformPaths,
} from "./utils";
import { dedent } from "./vutils/function";

interface OutputFileList {
  [outputDir: string]: {
    syntheticalConfig: SyntheticalConfig;
    content: string[];
    requestFunctionFilePath: string;
    requestHookMakerFilePath: string;
  };
}

export class Generator {
  /** 配置 */
  private config: ServerConfig[] = [];

  private disposes: Array<() => any> = [];

  constructor(
    config: Config,
    private options: { cwd: string } = { cwd: process.cwd() }
  ) {
    // config 可能是对象或数组，统一为数组
    this.config = castArray(config);
  }

  async prepare(): Promise<void> {
    this.config = await Promise.all(
      // config 可能是对象或数组，统一为数组
      this.config.map(async (item) => {
        if (item.serverType === "swagger") {
          const swaggerToYApiServer = new SwaggerToYApiServer({
            swaggerJsonUrl: item.serverUrl,
          });
          item.serverUrl = await swaggerToYApiServer.start();
          this.disposes.push(() => swaggerToYApiServer.stop());
        }
        if (item.serverType === "apifox") {
          // 获取第一个项目的第一个token
          const firstProject = item.projects[0];
          const firstToken = firstProject
            ? castArray(firstProject.token)[0]
            : "";

          const apifoxToYApiServer = new ApifoxToYApiServer({
            serverUrl: item.serverUrl,
            token: firstToken,
            projectId: item.apifoxProjectId || "6720131", // 使用配置中的项目ID，如果没有则使用默认值
          });
          item.serverUrl = await apifoxToYApiServer.start();
          this.disposes.push(() => apifoxToYApiServer.stop());
        }
        if (item.serverUrl) {
          // 去除地址后面的 /
          // fix: https://github.com/x011223/cis-api-tool.git/issues/22
          item.serverUrl = item.serverUrl.replace(/\/+$/, "");
        }
        return item;
      })
    );
  }

  /**
   * 清理输出目录，删除之前生成的文件但保留requestFunctionFilePath指定的文件
   */
  async cleanOutputDirectory(): Promise<void> {
    try {
      // 获取配置中的outputDir和requestFunctionFilePath
      const config = this.config[0];
      if (!config) return;

      const outputDir =
        typeof config.outputDir === "string" ? config.outputDir : "src/service";
      const requestFunctionFilePath =
        config.requestFunctionFilePath || "src/service/request.ts";

      // 检查outputDir是否存在
      const fullOutputDir = path.resolve(this.options.cwd, outputDir);
      if (!(await fs.pathExists(fullOutputDir))) {
        return; // 目录不存在，无需清理
      }

      // 获取requestFunctionFilePath的绝对路径
      const fullRequestFilePath = path.resolve(
        this.options.cwd,
        requestFunctionFilePath
      );

      // 检查requestFunctionFilePath是否在outputDir下
      const isRequestFileInOutputDir =
        fullRequestFilePath.startsWith(fullOutputDir + path.sep) ||
        fullRequestFilePath === fullOutputDir;

      if (!isRequestFileInOutputDir) {
        // 如果requestFunctionFilePath不在outputDir下，直接清空整个outputDir
        await fs.emptyDir(fullOutputDir);
        return;
      }

      // 如果requestFunctionFilePath在outputDir下，需要保留该文件
      // 先读取request文件内容（如果存在）
      let requestFileContent = "";
      if (await fs.pathExists(fullRequestFilePath)) {
        requestFileContent = await fs.readFile(fullRequestFilePath, "utf-8");
      }

      // 清空整个outputDir
      await fs.emptyDir(fullOutputDir);

      // 如果之前存在request文件，重新创建
      if (requestFileContent) {
        await fs.outputFile(fullRequestFilePath, requestFileContent);
      }
    } catch (error) {
      console.warn("清理输出目录时出现警告:", error);
      // 不抛出错误，继续执行
    }
  }

  async generate(): Promise<OutputFileList> {
    const outputFileList: OutputFileList = Object.create(null);

    await Promise.all(
      this.config.map(async (serverConfig, serverIndex) => {
        const projects = serverConfig.projects.reduce<ProjectConfig[]>(
          (projects, project) => {
            projects.push(
              ...castArray(project.token).map((token) => ({
                ...project,
                token: token,
              }))
            );
            return projects;
          },
          []
        );
        return Promise.all(
          projects.map(async (projectConfig, projectIndex) => {
            const projectInfo = await this.fetchProjectInfo({
              ...serverConfig,
              ...projectConfig,
            });
            await Promise.all(
              projectConfig.categories.map(
                async (categoryConfig, categoryIndex) => {
                  // 分类处理
                  // 数组化
                  let categoryIds = castArray(categoryConfig.id);
                  // 全部分类
                  if (categoryIds.includes(0)) {
                    categoryIds.push(...projectInfo.cats.map((cat) => cat._id));
                  }
                  // 唯一化
                  categoryIds = uniq(categoryIds);
                  // 去掉被排除的分类
                  const excludedCategoryIds = categoryIds
                    .filter((id) => id < 0)
                    .map(Math.abs);
                  categoryIds = categoryIds.filter(
                    (id) => !excludedCategoryIds.includes(Math.abs(id))
                  );
                  // 删除不存在的分类
                  categoryIds = categoryIds.filter(
                    (id) => !!projectInfo.cats.find((cat) => cat._id === id)
                  );
                  // 顺序化
                  categoryIds = categoryIds.sort();

                  const codes = (
                    await Promise.all(
                      categoryIds.map<
                        Promise<
                          Array<{
                            outputFilePath: string;
                            code: string;
                            weights: number[];
                          }>
                        >
                      >(async (id, categoryIndex2) => {
                        categoryConfig = {
                          ...categoryConfig,
                          id: id,
                        };
                        const syntheticalConfig: SyntheticalConfig = {
                          ...serverConfig,
                          ...projectConfig,
                          ...categoryConfig,
                          // mockUrl:
                          //     projectInfo.getMockUrl(),
                        };
                        syntheticalConfig.target =
                          syntheticalConfig.target || "typescript";
                        // syntheticalConfig.devUrl =
                        //     projectInfo.getDevUrl(
                        //         syntheticalConfig.devEnvName!
                        //     );
                        // syntheticalConfig.prodUrl =
                        //     projectInfo.getProdUrl(
                        //         syntheticalConfig.prodEnvName!
                        //     );

                        // 接口列表
                        let interfaceList = await this.fetchInterfaceList(
                          syntheticalConfig
                        );
                        interfaceList = interfaceList
                          .map((interfaceInfo) => {
                            // 实现 _project 字段
                            interfaceInfo._project = omit(
                              projectInfo,
                              "cats",
                              "getMockUrl",
                              "getDevUrl",
                              "getProdUrl"
                            );
                            // 预处理
                            let _interfaceInfo = isFunction(
                              syntheticalConfig.preproccessInterface
                            )
                              ? syntheticalConfig.preproccessInterface?.(
                                  cloneDeep(interfaceInfo),
                                  changeCase,
                                  syntheticalConfig
                                )
                              : interfaceInfo;

                            // 处理路径前缀
                            if (
                              _interfaceInfo &&
                              syntheticalConfig.pathPrefix
                            ) {
                              const pathPrefix = syntheticalConfig.pathPrefix;
                              if (_interfaceInfo.path.startsWith(pathPrefix)) {
                                _interfaceInfo.path =
                                  _interfaceInfo.path.substring(
                                    pathPrefix.length
                                  );
                                // 确保路径以 / 开头
                                if (!_interfaceInfo.path.startsWith("/")) {
                                  _interfaceInfo.path =
                                    "/" + _interfaceInfo.path;
                                }
                              }
                            }

                            return _interfaceInfo;
                          })
                          .filter(Boolean) as any;
                        interfaceList.sort((a, b) => a._id - b._id);

                        const interfaceCodes = await Promise.all(
                          interfaceList.map<
                            Promise<{
                              categoryUID: string;
                              outputFilePath: string;
                              weights: number[];
                              code: string;
                            }>
                          >(async (interfaceInfo) => {
                            const _filePath =
                              typeof syntheticalConfig.outputDir === "function"
                                ? syntheticalConfig.outputDir(
                                    interfaceInfo,
                                    changeCase
                                  )
                                : getOutputFilePath(
                                    interfaceInfo,
                                    changeCase,
                                    syntheticalConfig.outputDir || "src/service"
                                  );
                            const outputFilePath = path.resolve(
                              this.options.cwd,
                              _filePath
                            );
                            syntheticalConfig.fileDirectory = _filePath;
                            const categoryUID = `_${serverIndex}_${projectIndex}_${categoryIndex}_${categoryIndex2}`;
                            const code = await this.generateInterfaceCode(
                              syntheticalConfig,
                              interfaceInfo,
                              categoryUID
                            );
                            const weights: number[] = [
                              serverIndex,
                              projectIndex,
                              categoryIndex,
                              categoryIndex2,
                            ];
                            return {
                              categoryUID,
                              outputFilePath,
                              weights,
                              code,
                              // 相对路径
                              relativeFilePath: _filePath,
                            };
                          })
                        );

                        const groupedInterfaceCodes = groupBy(
                          interfaceCodes,
                          (item) => item.outputFilePath
                        );
                        return Object.keys(groupedInterfaceCodes).map(
                          (outputFilePath) => {
                            const categoryCode = groupedInterfaceCodes[
                              outputFilePath
                            ]
                              .map((item) => item.code)
                              .filter(Boolean)
                              .join("\n\n");
                            if (!outputFileList[outputFilePath]) {
                              outputFileList[outputFilePath] = {
                                syntheticalConfig,
                                content: [],
                                requestFunctionFilePath:
                                  syntheticalConfig.requestFunctionFilePath
                                    ? path.isAbsolute(
                                        syntheticalConfig.requestFunctionFilePath
                                      )
                                      ? path.resolve(
                                          this.options.cwd,
                                          syntheticalConfig.requestFunctionFilePath
                                        )
                                      : path.resolve(
                                          this.options.cwd,
                                          syntheticalConfig.requestFunctionFilePath
                                        )
                                    : path.join(
                                        path.dirname(outputFilePath),
                                        "request.ts"
                                      ),
                                requestHookMakerFilePath:
                                  syntheticalConfig.reactHooks &&
                                  syntheticalConfig.reactHooks.enabled
                                    ? syntheticalConfig.reactHooks
                                        .requestHookMakerFilePath
                                      ? path.isAbsolute(
                                          syntheticalConfig.reactHooks
                                            .requestHookMakerFilePath
                                        )
                                        ? path.resolve(
                                            this.options.cwd,
                                            syntheticalConfig.reactHooks
                                              .requestHookMakerFilePath
                                          )
                                        : path.resolve(
                                            this.options.cwd,
                                            syntheticalConfig.reactHooks
                                              .requestHookMakerFilePath
                                          )
                                      : path.join(
                                          path.dirname(outputFilePath),
                                          "makeRequestHook.ts"
                                        )
                                    : "",
                              };
                            }
                            return {
                              outputFilePath: outputFilePath,
                              code: categoryCode,
                              weights: last(
                                sortByWeights(
                                  groupedInterfaceCodes[outputFilePath]
                                )
                              )!.weights,
                            };
                          }
                        );
                      })
                    )
                  ).flat();

                  for (const groupedCodes of values(
                    groupBy(codes, (item: any) => item.outputFilePath)
                  )) {
                    sortByWeights(groupedCodes);
                    outputFileList[groupedCodes[0].outputFilePath].content.push(
                      ...groupedCodes.map((item: any) => item.code)
                    );
                  }
                }
              )
            );
          })
        );
      })
    );

    return outputFileList;
  }

  /**
   * 生成index.ts文件，将目录中的所有方法和interface类型导出
   * @param directoryPaths 目录路径
   * @param outputDir 输出目录，默认为 'src/service'
   */
  async generateIndexFile(
    directoryPaths: string[],
    outputDir: string = "src/service"
  ) {
    const indexPath = path.resolve(this.options.cwd, outputDir, "index.ts");

    // 检查目录是否存在
    if (!(await fs.pathExists(indexPath))) {
      // 创建index.ts文件
      await fs.writeFile(indexPath, "");
    }

    // 递归处理所有目录，包括子目录
    const allDirectories = new Set<string>();

    // 收集所有目录和子目录
    for (const dir of directoryPaths) {
      // 检查根目录是否有 index.ts 文件
      const rootIndexPath = path.resolve(this.options.cwd, dir, "index.ts");
      if (await fs.pathExists(rootIndexPath)) {
        allDirectories.add(dir);
      }
      await this.collectSubDirectories(dir, allDirectories);
    }

    let content =
      "/* prettier-ignore-start */\n/* tslint:disable */\n/* eslint-disable */\n\n/* 该文件由 cis-api-tool 自动生成，请勿直接修改！！！ */\n\n";

    // 生成index.ts文件内容
    const indexContent = transformPaths(
      Array.from(allDirectories),
      outputDir
    ).join("\n");
    content += indexContent;
    content += "\n/* prettier-ignore-end */";

    await fs.writeFile(indexPath, content);
  }

  // 新增方法：递归收集子目录
  private async collectSubDirectories(
    dirPath: string,
    allDirectories: Set<string>
  ) {
    try {
      const fullPath = path.resolve(this.options.cwd, dirPath);
      if (await fs.pathExists(fullPath)) {
        const items = await fs.readdir(fullPath);
        for (const item of items) {
          const itemPath = path.join(fullPath, item);
          const stat = await fs.stat(itemPath);
          if (stat.isDirectory()) {
            // 使用 path.join 来确保路径分隔符的一致性
            const subDirPath = path.join(dirPath, item);

            // 检查子目录是否有 index.ts 文件
            const indexFilePath = path.join(itemPath, "index.ts");
            if (await fs.pathExists(indexFilePath)) {
              allDirectories.add(subDirPath);
            }

            // 递归处理子目录
            await this.collectSubDirectories(subDirPath, allDirectories);
          }
        }
      }
    } catch (error) {
      // 忽略错误，继续处理其他目录
      console.warn(
        `Warning: Failed to collect subdirectories for ${dirPath}:`,
        error
      );
    }
  }

  async write(outputFileList: OutputFileList) {
    const result = await Promise.all(
      Object.keys(outputFileList).map(async (outputFilePath) => {
        let {
          // eslint-disable-next-line prefer-const
          content,
          requestFunctionFilePath,
          requestHookMakerFilePath,
          // eslint-disable-next-line prefer-const
          syntheticalConfig,
        } = outputFileList[outputFilePath];

        const rawRequestFunctionFilePath = requestFunctionFilePath;
        const rawRequestHookMakerFilePath = requestHookMakerFilePath;

        // 支持 .jsx? 后缀
        outputFilePath = outputFilePath.replace(/\.js(x)?$/, ".ts$1");
        requestFunctionFilePath = requestFunctionFilePath.replace(
          /\.js(x)?$/,
          ".ts$1"
        );
        requestHookMakerFilePath = requestHookMakerFilePath.replace(
          /\.js(x)?$/,
          ".ts$1"
        );

        if (!syntheticalConfig.typesOnly) {
          if (!(await fs.pathExists(rawRequestFunctionFilePath))) {
            await fs.outputFile(
              requestFunctionFilePath,
              dedent`
                import type { RequestFunctionParams } from 'cis-api-tool'

                export interface RequestOptions {
                    /**
                     * 使用的服务器。
                     *
                     * - \`prod\`: 生产服务器
                     * - \`dev\`: 测试服务器
                     * - \`mock\`: 模拟服务器
                     *
                     * @default prod
                     */
                    server?: 'prod' | 'dev' | 'mock',
                }

                export default function request<TResponseData>(
                    payload: RequestFunctionParams,
                    options: RequestOptions = {
                        server: 'prod',
                    },
                ): Promise<TResponseData> {
                    return new Promise<TResponseData>((resolve, reject) => {
                        // 基本地址
                        const baseUrl = options.server === 'mock'
                            ? payload.mockUrl
                            : options.server === 'dev'
                                ? payload.devUrl
                                : payload.prodUrl

                        // 请求地址
                        const url = \`\${baseUrl}\${payload.path}\`

                        // 具体请求逻辑
                    })
                }
            `
            );
          }
          if (
            syntheticalConfig.reactHooks &&
            syntheticalConfig.reactHooks.enabled &&
            !(await fs.pathExists(rawRequestHookMakerFilePath))
          ) {
            await fs.outputFile(
              requestHookMakerFilePath,
              dedent`
                import { useState, useEffect } from 'react'
                import type { RequestConfig } from 'cis-api-tool'
                import type { Request } from ${JSON.stringify(
                  getNormalizedPathWithAlias(
                    requestHookMakerFilePath,
                    outputFilePath,
                    typeof syntheticalConfig.outputDir === "string"
                      ? syntheticalConfig.outputDir
                      : "src/service"
                  )
                )}
                import baseRequest from ${JSON.stringify(
                  getNormalizedPathWithAlias(
                    requestHookMakerFilePath,
                    requestFunctionFilePath,
                    typeof syntheticalConfig.outputDir === "string"
                      ? syntheticalConfig.outputDir
                      : "src/service"
                  )
                )}

                export default function makeRequestHook<TRequestData, TRequestConfig extends RequestConfig, TRequestResult extends ReturnType<typeof baseRequest>>(request: Request<TRequestData, TRequestConfig, TRequestResult>) {
                    type Data = TRequestResult extends Promise<infer R> ? R : TRequestResult
                    return function useRequest(requestData: TRequestData) {
                        // 一个简单的 Hook 实现，实际项目可结合其他库使用，比如：
                        // @umijs/hooks 的 useRequest (https://github.com/umijs/hooks)
                        // swr (https://github.com/zeit/swr)

                        const [loading, setLoading] = useState(true)
                        const [data, setData] = useState<Data>()

                        useEffect(() => {
                            request(requestData).then(data => {
                                setLoading(false)
                                setData(data as any)
                            })
                        }, [JSON.stringify(requestData)])

                        return {
                            loading,
                            data,
                        }
                    }
                }
            `
            );
          }
        }

        // 始终写入主文件
        const rawOutputContent = dedent`
                    /* tslint:disable */
                    /* eslint-disable */

                    /* 该文件由 cis-api-tool 自动生成，请勿直接修改！！！ */

                    ${
                      syntheticalConfig.typesOnly
                        ? dedent`
                        // @ts-ignore
                        type FileData = File

                        ${content.join("\n\n").trim()}
                    `
                        : dedent`
                        // @ts-ignore
                        import request from ${JSON.stringify(
                          getNormalizedPathWithAlias(
                            outputFilePath,
                            requestFunctionFilePath,
                            typeof syntheticalConfig.outputDir === "string"
                              ? syntheticalConfig.outputDir
                              : "src/service"
                          )
                        )}

                        ${content.join("\n\n").trim()}
                    `
                    }
                `;
        // ref: https://prettier.io/docs/en/options.html
        const prettier = await getPrettier(this.options.cwd);
        // 此处需用 await 以兼容 Prettier 3
        const prettyOutputContent = await prettier.format(rawOutputContent, {
          ...(await getCachedPrettierOptions()),
          filepath: outputFilePath,
        });
        const outputContent = `${dedent`
                    /* prettier-ignore-start */
                    ${prettyOutputContent}
                    /* prettier-ignore-end */
                `}\n`;
        await fs.outputFile(outputFilePath, outputContent);

        // 如果要生成 JavaScript 代码，
        // 则先对主文件进行 tsc 编译，主文件引用到的其他文件也会被编译，
        // 然后，删除原始的 .tsx? 文件。
        if (syntheticalConfig.target === "javascript") {
          await this.tsc(outputFilePath);
          await Promise.all([
            fs.remove(requestFunctionFilePath).catch(noop),
            fs.remove(requestHookMakerFilePath).catch(noop),
            fs.remove(outputFilePath).catch(noop),
          ]);
        }

        return outputFilePath;
      })
    );
    // 生成index.ts文件
    // 收集所有生成的文件所在的目录
    const directories = new Set<string>();
    result.forEach((outputFilePath) => {
      const dirPath = path.dirname(outputFilePath);
      directories.add(dirPath);
    });
    // 找出所有根目录（不是其他目录的子目录的目录）
    const rootDirs = Array.from(directories).filter((dir) => {
      return !Array.from(directories).some((otherDir) => {
        return dir !== otherDir && dir.startsWith(otherDir + path.sep);
      });
    });

    // 从配置中获取输出目录，默认使用 'src/service'
    let outputDir = "src/service";
    if (this.config[0]?.outputDir) {
      if (typeof this.config[0].outputDir === "string") {
        outputDir = this.config[0].outputDir;
      } else {
        // 如果是函数，使用默认值
        outputDir = "src/service";
      }
    }
    await this.generateIndexFile(rootDirs, outputDir);
    return outputFileList;
  }

  async tsc(file: string) {
    return new Promise<void>((resolve) => {
      // add this to fix bug that not-generator-file-on-window
      const command = `${
        require("os").platform() === "win32" ? "node " : ""
      }${JSON.stringify(require.resolve(`typescript/bin/tsc`))}`;

      exec(
        `${command} --target ES2019 --module ESNext --jsx preserve --declaration --esModuleInterop ${JSON.stringify(
          file
        )}`,
        {
          cwd: this.options.cwd,
          env: process.env,
        },
        () => resolve()
      );
    });
  }

  async fetchApi<T = any>(url: string, query: Record<string, any>): Promise<T> {
    const res = await httpGet<{
      errcode: any;
      errmsg: any;
      data: any;
    }>(url, query);
    /* istanbul ignore next */
    if (res && res.errcode) {
      throwError(
        `${res.errmsg} [请求地址: ${url}] [请求参数: ${new URLSearchParams(
          query
        ).toString()}]`
      );
    }
    return res.data || res;
  }

  fetchProject = memoize(async ({ serverUrl, token }: SyntheticalConfig) => {
    const projectInfo = await this.fetchApi<Project>(
      `${serverUrl}/api/project/get`,
      {
        token: token!,
      }
    );
    const basePath = `/${projectInfo.basepath || "/"}`
      .replace(/\/+$/, "")
      .replace(/^\/+/, "/");
    projectInfo.basepath = basePath;
    // 实现项目在 YApi 上的地址
    projectInfo._url = `${serverUrl}/project/${projectInfo._id}/interface/api`;
    return projectInfo;
  });

  fetchExport = memoize(async ({ serverUrl, token }: SyntheticalConfig) => {
    const projectInfo = await this.fetchProject({ serverUrl, token });
    const categoryList = await this.fetchApi<CategoryList>(
      `${serverUrl}/api/plugin/export`,
      {
        type: "json",
        status: "all",
        isWiki: "false",
        token: token!,
      }
    );
    return categoryList.map((cat) => {
      const projectId = cat.list?.[0]?.project_id || 0;
      const catId = cat.list?.[0]?.catid || 0;
      // 实现分类在 YApi 上的地址
      cat._url = `${serverUrl}/project/${projectId}/interface/api/cat_${catId}`;
      cat.list = (cat.list || []).map((item) => {
        const interfaceId = item._id;
        // 实现接口在 YApi 上的地址
        item._url = `${serverUrl}/project/${projectId}/interface/api/${interfaceId}`;
        item.path = `${projectInfo.basepath}${item.path}`;
        return item;
      });
      return cat;
    });
  });

  /** 获取分类的接口列表 */
  async fetchInterfaceList({
    serverUrl,
    token,
    id,
  }: SyntheticalConfig): Promise<InterfaceList> {
    const category = (
      (await this.fetchExport({ serverUrl, token })) || []
    ).find(
      (cat: any) =>
        !isEmpty(cat) && !isEmpty(cat.list) && cat.list[0].catid === id
    );

    if (category) {
      category.list.forEach((interfaceInfo: any) => {
        // 实现 _category 字段
        interfaceInfo._category = omit(category, "list");
      });
    }

    return category ? category.list : [];
  }

  /** 获取项目信息 */
  async fetchProjectInfo(syntheticalConfig: SyntheticalConfig) {
    const projectInfo = await this.fetchProject(syntheticalConfig);
    const projectCats = await this.fetchApi<CategoryList>(
      `${syntheticalConfig.serverUrl}/api/interface/getCatMenu`,
      {
        token: syntheticalConfig.token!,
        project_id: projectInfo._id,
      }
    );
    return {
      ...projectInfo,
      cats: projectCats,
      getMockUrl: () =>
        `${syntheticalConfig.serverUrl}/mock/${projectInfo._id}`,
      getDevUrl: (devEnvName: string) => {
        const env = projectInfo.env.find((e: any) => e.name === devEnvName);
        return (env && env.domain) /* istanbul ignore next */ || "";
      },
      getProdUrl: (prodEnvName: string) => {
        const env = projectInfo.env.find((e: any) => e.name === prodEnvName);
        return (env && env.domain) /* istanbul ignore next */ || "";
      },
    };
  }

  /** 生成接口代码 */
  async generateInterfaceCode(
    syntheticalConfig: SyntheticalConfig,
    interfaceInfo: Interface,
    categoryUID: string
  ) {
    const extendedInterfaceInfo: ExtendedInterface = {
      ...interfaceInfo,
      parsedPath: path.parse(interfaceInfo.path),
    };
    const requestFunctionName = isFunction(
      syntheticalConfig.getRequestFunctionName
    )
      ? await syntheticalConfig.getRequestFunctionName?.(
          extendedInterfaceInfo,
          changeCase
        )
      : getRequestFunctionName(extendedInterfaceInfo, changeCase);
    const requestDataTypeName = isFunction(
      syntheticalConfig.getRequestDataTypeName
    )
      ? await syntheticalConfig.getRequestDataTypeName?.(
          extendedInterfaceInfo,
          changeCase
        )
      : getRequestDataTypeName(extendedInterfaceInfo, changeCase);
    const responseDataTypeName = isFunction(
      syntheticalConfig.getResponseDataTypeName
    )
      ? await syntheticalConfig.getResponseDataTypeName?.(
          extendedInterfaceInfo,
          changeCase
        )
      : getReponseDataTypeName(extendedInterfaceInfo, changeCase);
    const requestDataJsonSchema = getRequestDataJsonSchema(
      extendedInterfaceInfo,
      syntheticalConfig.customTypeMapping || {}
    );
    const requestDataType = await jsonSchemaToType(
      requestDataJsonSchema,
      requestDataTypeName!
    );

    const responseDataJsonSchema = getResponseDataJsonSchema(
      extendedInterfaceInfo,
      syntheticalConfig.customTypeMapping || {},
      syntheticalConfig.dataKey
    );
    const responseDataType = await jsonSchemaToType(
      responseDataJsonSchema,
      responseDataTypeName!
    );
    const isRequestDataOptional = /(\{\}|any)$/g.test(requestDataType);
    const requestHookName =
      syntheticalConfig.reactHooks && syntheticalConfig.reactHooks.enabled
        ? isFunction(syntheticalConfig.reactHooks.getRequestHookName)
          ? /* istanbul ignore next */
            await syntheticalConfig.reactHooks.getRequestHookName?.(
              extendedInterfaceInfo,
              changeCase
            )
          : `use${changeCase.pascalCase(requestFunctionName)}`
        : "";

    // 处理路径参数，将 {paramName} 格式替换为模板字符串格式
    const processPathParams = (
      path: string
    ): {
      processedPath: string;
      useTemplate: boolean;
      pathParamNames: string[];
      originalPathParamNames: string[];
    } => {
      // 检查是否包含路径参数
      const hasPathParams = /\{[^}]+\}/.test(path);
      if (!hasPathParams) {
        return {
          processedPath: path,
          useTemplate: false,
          pathParamNames: [],
          originalPathParamNames: [],
        };
      }
      // 匹配 {paramName} 格式的路径参数
      const pathParamNames: string[] = [];
      const originalPathParamNames: string[] = [];
      const processedPath = path.replace(/\{([^}]+)\}/g, (match, paramName) => {
        // 保存原始参数名称
        originalPathParamNames.push(paramName);
        // 确保参数名称是有效的标识符，如果是数字则添加前缀
        const validParamName = /^\d+$/.test(paramName)
          ? `param_${paramName}`
          : paramName;
        pathParamNames.push(validParamName);
        return "${params." + validParamName + "}";
      });
      return {
        processedPath,
        useTemplate: true,
        pathParamNames,
        originalPathParamNames,
      };
    };

    // 接口注释
    const genComment = (genTitle: (title: string) => string) => {
      const {
        enabled: isEnabled = true,
        title: hasTitle = true,
        category: hasCategory = true,
        tag: hasTag = true,
        requestHeader: hasRequestHeader = true,
        updateTime: hasUpdateTime = true,
        link: hasLink = true,
        extraTags,
      } = {
        ...syntheticalConfig.comment,
        // Swagger 时总是禁用标签、更新时间、链接
        ...(syntheticalConfig.serverType === "swagger"
          ? {
              tag: false,
              updateTime: false,
              link: false,
            }
          : {}),
      } as CommentConfig;
      if (!isEnabled) {
        return "";
      }
      // 转义标题中的 /
      const escapedTitle = String(extendedInterfaceInfo.title).replace(
        /\//g,
        "\\/"
      );
      const description = escapedTitle;
      const summary: Array<
        | false
        | {
            label: string;
            value: string | string[];
          }
      > = [
        hasCategory && {
          label: "category",
          value: extendedInterfaceInfo._category.name,
        },
        hasTag && {
          label: "tags",
          value: extendedInterfaceInfo.tag.map((tag) => `${tag}`),
        },
        hasRequestHeader && {
          label: "method",
          value: `${extendedInterfaceInfo.method.toUpperCase()}`,
        },
        hasRequestHeader && {
          label: "path",
          value: `${extendedInterfaceInfo.path}`,
        },
        // hasUpdateTime && {
        //     label: "updateTime",
        //     value: process.env.JEST_WORKER_ID // 测试时使用 unix 时间戳
        //         ? String(extendedInterfaceInfo.up_time)
        //         : /* istanbul ignore next */
        //           `\`${dayjs(
        //               extendedInterfaceInfo.up_time * 1000
        //           ).format("YYYY-MM-DD HH:mm:ss")}\``,
        // },
      ];
      if (typeof extraTags === "function") {
        const tags = extraTags(extendedInterfaceInfo);
        for (const tag of tags) {
          (tag.position === "start" ? summary.unshift : summary.push).call(
            summary,
            {
              label: tag.name,
              value: tag.value,
            }
          );
        }
      }
      const titleComment = hasTitle
        ? dedent`
                * ${genTitle(description)}
                *
              `
        : "";
      const extraComment: string = summary
        .filter((item) => typeof item !== "boolean" && !isEmpty(item.value))
        .map((item) => {
          const _item: Exclude<(typeof summary)[0], boolean> = item as any;
          return `* @${_item.label} ${castArray(_item.value).join(", ")}`;
        })
        .join("\n");
      return dedent`
            /**
             ${[titleComment, extraComment].filter(Boolean).join("\n")}
             */
          `;
    };

    // 检测是否为文件下载接口的函数
    const isFileDownloadInterface = (
      interfaceInfo: ExtendedInterface
    ): boolean => {
      try {
        // TODO: 保留这个调试信息
        // if (interfaceInfo?.path?.includes('export')) {
        //   consola.info(interfaceInfo.res_body,  interfaceInfo.res_body_is_json_schema,'interfaceInfo')
        // }
        //  检查响应体是否为空对象schema (主要检测方式)
        if (
          interfaceInfo.res_body_type === "json" &&
          interfaceInfo.res_body_is_json_schema &&
          interfaceInfo.res_body
        ) {
          try {
            const resBodySchema = JSON.parse(interfaceInfo.res_body);
            if (
              resBodySchema.type === "object" &&
              resBodySchema.content === "application/octet-stream"
            ) {
              return true;
            }

            if (
              resBodySchema.type === "object" &&
              resBodySchema.content === "*/*"
            ) {
              return true;
            }
          } catch (e) {
            // 解析失败，继续其他检测方式
          }
        }

        // TODO: 检查路径是否包含导出关键词
        // if (interfaceInfo.path && interfaceInfo.path.includes("/export")) {
        //   return true;
        // }

        // TODO: 检查接口描述是否包含导出、下载等关键词
        // if (interfaceInfo.title || interfaceInfo.desc) {
        //   const description =
        //     (interfaceInfo.title || "") + (interfaceInfo.desc || "");
        //   const downloadKeywords = [
        //     "导出",
        //     "下载",
        //     "export",
        //     "download",
        //     "file",
        //   ];
        //   return downloadKeywords.some((keyword) =>
        //     description.toLowerCase().includes(keyword.toLowerCase())
        //   );
        // }

        return false;
      } catch (error) {
        console.warn("检测文件下载接口时出错:", error);
        return false;
      }
    };

    // 检查当前接口是否为文件下载接口
    const isDownloadInterface = isFileDownloadInterface(extendedInterfaceInfo);

    // 处理路径参数
    const {
      processedPath,
      useTemplate,
      pathParamNames,
      originalPathParamNames,
    } = processPathParams(extendedInterfaceInfo.path);

    return dedent`
            ${genComment(
              (title) => `@description 接口 ${title} 的 **请求类型**`
            )}
            ${requestDataType.trim()}

            ${genComment(
              (title) => `@description 接口 ${title} 的 **返回类型**`
            )}
            ${responseDataType.trim()}

      ${
        syntheticalConfig.typesOnly
          ? ""
          : dedent`
                ${genComment(
                  (title) => `@description 接口 ${title} 的 **请求函数**`
                )}
                export const ${
                  requestFunctionName || "ErrorRequestFunctionName"
                } = (
                  params: ${requestDataTypeName!}
                ) => {
                  return request.${extendedInterfaceInfo.method.toLowerCase()}<${responseDataTypeName!}>(
                    ${
                      useTemplate
                        ? `\`${processedPath}\``
                        : JSON.stringify(processedPath)
                    }${
              originalPathParamNames.length > 0
                ? isDownloadInterface
                  ? `, undefined`
                  : ``
                : `, params`
            }${
              isDownloadInterface
                ? `, {
        responseType: 'blob',
    }`
                : ``
            }
                  )
                }
              `
      }
    `;
  }

  async destroy() {
    return Promise.all(this.disposes.map(async (dispose) => dispose()));
  }
}
