import { defineConfig } from "./src";

export default defineConfig([
  {
    // serverUrl: 'http://127.0.0.1:4523/export/openapi/2?version=3.1',
    // serverType: 'swagger',
    // 方式1：使用基础URL + apifoxProjectId配置
    serverUrl: "https://api.apifox.com",
    serverType: "apifox",
    apifoxProjectId: "6720131", // 新增：Apifox项目ID配置
    // 方式2：也可以直接在serverUrl中包含项目ID（向后兼容）
    // serverUrl: 'https://api.apifox.com/v1/projects/6720131/export-openapi',
    // serverType: 'apifox',
    // 此时可以不设置apifoxProjectId，代码会自动从URL中提取
    typesOnly: false,
    target: "typescript",
    // 统一去掉接口路径的某部分，例如 '/api'
    // pathPrefix: "/api",
    reactHooks: {
      enabled: false,
    },
    prodEnvName: "production",
    // 输出目录，默认为 'src/service'
    outputDir: "src/service",
    requestFunctionFilePath: "src/service/request.ts",
    dataKey: "data",
    projects: [
      {
        // APS-QJLxBBUyhhxjVaEHY4zwmeRrZoarUwCv
        // APS-aMDN8zefvjQbwj60rILwqB2hogDmWkh7
        token: "APS-QGtEsGJngJHGZvKKbWU2wDUXbmJDcWHg",
        categories: [
          {
            id: 0,
            // getRequestFunctionName(interfaceInfo, changeCase) {
            //   以接口全路径生成请求函数名
            //   return changeCase.camelCase(interfaceInfo.path)
            //   若生成的请求函数名存在语法关键词报错、或想通过某个关键词触发 IDE 自动引入提示，可考虑加前缀，如:
            //   return changeCase.camelCase(`api_${interfaceInfo.path}`)
            //   若生成的请求函数名有重复报错，可考虑将接口请求方式纳入生成条件，如:
            //   return changeCase.camelCase(`${interfaceInfo.method}_${interfaceInfo.path}`)
            // },
          },
        ],
      },
    ],
  },
]);
