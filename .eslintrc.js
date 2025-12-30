module.exports = {
    // 环境配置：Node.js环境 + ES2021特性 + Jest测试
    env: {
      node: true,
      es2021: true,
      jest: true
    },
    // 继承的规则集
    extends: [
      'eslint:recommended',
      'plugin:@typescript-eslint/recommended',
      'plugin:@typescript-eslint/recommended-requiring-type-checking',
      'plugin:import/recommended',
      'plugin:import/typescript',
      'plugin:prettier/recommended' // 与Prettier集成
    ],
    // TypeScript解析器
    parser: '@typescript-eslint/parser',
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      project: './tsconfig.json', // 必须指定tsconfig路径以启用类型检查
      tsconfigRootDir: __dirname
    },
    // 使用的插件
    plugins: [
      '@typescript-eslint',
      'import',
      'prettier',
      'node' // Node.js特定规则
    ],
    // 自定义规则
    rules: {
      // 基础JavaScript规则
      'no-console': ['warn', { allow: ['warn', 'error'] }], // 允许警告和错误日志
      'no-debugger': 'warn',
      'eqeqeq': ['error', 'always'], // 强制使用===和!==
      'no-var': 'error', // 禁止var，使用let/const
      'prefer-const': 'error', // 优先使用const
      'arrow-body-style': ['error', 'as-needed'], // 箭头函数体简化
      'no-unused-vars': 'off', // 由TS规则接管
  
      // Node.js特定规则
      'node/no-missing-import': 'off', // 由TS处理
      'node/no-unsupported-features/es-syntax': ['error', { ignores: ['modules'] }],
      'node/shebang': 'error', // 脚本文件需要正确的shebang
  
      // TypeScript规则
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }], // 忽略下划线开头的参数
      '@typescript-eslint/explicit-module-boundary-types': 'error', // 要求导出函数有明确返回类型
      '@typescript-eslint/no-explicit-any': 'warn', // 警告使用any类型
      '@typescript-eslint/no-floating-promises': 'error', // 禁止未处理的Promise
      '@typescript-eslint/await-thenable': 'error', // 确保await的是Promise
      '@typescript-eslint/consistent-type-imports': 'error', // 统一类型导入风格
      '@typescript-eslint/no-unsafe-member-access': 'warn', // 不安全的成员访问警告
      '@typescript-eslint/restrict-template-expressions': 'warn', // 限制模板字符串中的表达式类型
  
      // Import规则
      'import/order': ['error', {
        groups: [
          ['builtin', 'external'], // 内置模块和外部模块优先
          'internal', // 内部模块
          ['parent', 'sibling', 'index'] // 相对路径
        ],
        'newlines-between': 'always', // 不同组之间空行
        alphabetize: { order: 'asc', caseInsensitive: true } // 按字母排序
      }],
      'import/no-unresolved': 'off', // 由TypeScript处理
      'import/extensions': ['error', 'ignorePackages', {
        ts: 'never',
        js: 'never'
      }], // 禁止导入时带扩展名
  
      // Prettier集成
      'prettier/prettier': 'error'
    },
    // 解析器设置
    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.json'
        },
        node: {
          extensions: ['.ts', '.js']
        }
      }
    },
    // 针对特定文件的覆盖规则
    overrides: [
      {
        files: ['*.js'],
        rules: {
          '@typescript-eslint/no-var-requires': 'off', // 允许JS文件使用require
          '@typescript-eslint/explicit-module-boundary-types': 'off' // JS文件不需要类型声明
        }
      },
      {
        files: ['*.test.ts', '*.spec.ts'],
        rules: {
          'node/no-unpublished-import': 'off', // 测试文件允许导入开发依赖
          '@typescript-eslint/no-explicit-any': 'off' // 测试文件放宽any限制
        }
      }
    ]
  };
      