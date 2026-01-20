#!/usr/bin/env node
import * as TSNode from "ts-node";
import consola from "consola";
import fs from "fs-extra";
import ora from "ora";
import path from "path";
import prompt from "prompts";
import yargs from "yargs";
import { ConfigWithHooks, ServerConfig } from "./types";
import { dedent, wait } from "./vutils/function";
import { Defined } from "./vutils/type";
import { Generator } from "./Generator";

console.log('cis-api-tool')

TSNode.register({
  // 不加载本地的 tsconfig.json
  skipProject: true,
  // 仅转译，不做类型检查
  transpileOnly: true,
  // 自定义编译选项
  compilerOptions: {
    strict: false,
    target: "es2017",
    module: "commonjs",
    moduleResolution: "node",
    declaration: false,
    removeComments: false,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    importHelpers: false,
    // 转换 js，支持在 apiPower.config.js 里使用最新语法
    allowJs: true,
    lib: ["ESNext"],
  },
});

export async function run(
  cmd: string | undefined,
  options?: {
    configFile?: string;
  }
) {
  let useCustomConfigFile = false;
  let cwd!: string;
  let configTSFile!: string;
  let configJSFile!: string;
  let configFile!: string;
  let configFileExist!: boolean;

  if (!options?.configFile) {
    cwd = process.cwd();
    configTSFile = path.join(cwd, "apiPower.config.ts");
    configJSFile = path.join(cwd, "apiPower.config.js");
    const configTSFileExist = await fs.pathExists(configTSFile);
    const configJSFileExist =
      !configTSFileExist && (await fs.pathExists(configJSFile));
    configFileExist = configTSFileExist || configJSFileExist;
    configFile = configTSFileExist ? configTSFile : configJSFile;
  } else {
    useCustomConfigFile = true;
    configFile = options.configFile;
    cwd = path.dirname(configFile);
    configFileExist = await fs.pathExists(configFile);
  }

  if (cmd === "help") {
    console.log(
      `\n${dedent`
                # 用法
                    初始化配置文件: apiPower init
                    生成代码: apiPower
                    查看帮助: apiPower help

                # GitHub
                    https://github.com/x011223/cis-api-tool.git
            `}\n`
    );
  } else if (cmd === "init") {
    if (configFileExist) {
      consola.info(`检测到配置文件: ${configFile}`);
      const answers = await prompt({
        message: "是否覆盖已有配置文件?",
        name: "override",
        type: "confirm",
      });
      if (!answers.override) return;
    }
    let outputConfigFile!: string;
    let outputConfigFileType!: "ts" | "js";
    if (useCustomConfigFile) {
      outputConfigFile = configFile;
      outputConfigFileType = configFile.endsWith(".js") ? "js" : "ts";
    } else {
      const answers = await prompt({
        message: "选择配置文件类型?",
        name: "configFileType",
        type: "select",
        choices: [
          { title: "TypeScript(apiPower.config.ts)", value: "ts" },
          { title: "JavaScript(apiPower.config.js)", value: "js" },
        ],
      });
      outputConfigFile =
        answers.configFileType === "js" ? configJSFile : configTSFile;
      outputConfigFileType = answers.configFileType;
    }
    await fs.outputFile(
      outputConfigFile,
      dedent`
                import { defineConfig } from 'cis-api-tool'

                export default defineConfig([
                    {
                        serverUrl: 'http://github.com/x011223/cis-api-tool',
                        serverType: 'swagger',
                        typesOnly: false,
                        target: '${
                          (outputConfigFileType === "js"
                            ? "javascript"
                            : "typescript") as Defined<ServerConfig["target"]>
                        }',
                        reactHooks: {
                            enabled: false,
                        },
                        prodEnvName: 'production',
                        outputFilePath: 'src/api/index.${outputConfigFileType}',
                        requestFunctionFilePath: 'src/api/request.${outputConfigFileType}',
                        dataKey: 'data',
                        projects: [
                            {
                                token: 'hello',
                                categories: [
                                    {
                                        id: 0,
                                        // getRequestFunctionName(interfaceInfo, changeCase) {
                                        //   以接口全路径生成请求函数名
                                        //   return changeCase.camelCase(interfaceInfo.path)
                                        //   若生成的请求函数名存在语法关键词报错、或想通过某个关键词触发 IDE 自动引入提示，可考虑加前缀，如:
                                        //   return changeCase.camelCase(\`api_\${interfaceInfo.path}\`)
                                        //   若生成的请求函数名有重复报错，可考虑将接口请求方式纳入生成条件，如:
                                        //   return changeCase.camelCase(\`\${interfaceInfo.method}_\${interfaceInfo.path}\`)
                                        // },
                                    },
                                ],
                            },
                        ],
                    },
                ])
            `
    );
    consola.success("写入配置文件完毕");
  } else {
    if (!configFileExist) {
      return consola.error(
        `找不到配置文件: ${
          useCustomConfigFile
            ? configFile
            : `${configTSFile} 或 ${configJSFile}`
        }`
      );
    }
    consola.success(`找到配置文件: ${configFile}`);
    let config: ConfigWithHooks | undefined;
    let generator: Generator | undefined;
    let spinner: ora.Ora | undefined;
    try {
      config = require(configFile).default;
      generator = new Generator(config!, { cwd });
      // 清理outputDir下的文件，但保留requestFunctionFilePath指定的文件
      await generator.cleanOutputDirectory();
      consola.info(
        `清理outputDir下的文件，但保留requestFunctionFilePath指定的文件`
      );
      spinner = ora("正在获取数据并生成代码...").start();
      const delayNotice = wait(5000);
      delayNotice.then(() => {
        spinner!.text = `正在获取数据并生成代码... (若长时间处于此状态，请检查是否有接口定义的数据过大导致拉取或解析缓慢)`;
      });
      await generator.prepare();
      delayNotice.cancel();

      const output = await generator.generate();
      spinner.stop();
      consola.success("获取数据并生成代码完毕");

      await generator.write(output);
      consola.success("写入文件完毕");
      await generator.destroy();
      await config!.hooks?.success?.();
    } catch (err) {
      spinner?.stop();
      await generator?.destroy();
      await config?.hooks?.fail?.();
      /* istanbul ignore next */
      consola.error(err);
    }
    await config?.hooks?.complete?.();
  }
}

/* istanbul ignore next */
if (require.main === module) {
  const argv = yargs(process.argv).alias("c", "config").argv;
  run(argv._[2] as any, {
    configFile: argv.config
      ? path.resolve(process.cwd(), argv.config as string)
      : undefined,
  });
}
