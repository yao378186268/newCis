import { isPlainObject, forOwn, has } from "lodash";

/**
 * @description 移除每一行的公共前导空白。
 * @public
 * @param text 文本
 * @returns 返回处理后的结果
 * @example
 * ```typescript
 * dedent(' a\n b') // => 'a\nb'
 * ```
 */
export function dedent(text: string): string;

/**
 * @description 首先，每一行紧跟前导空白的插入值为多行时，保持缩进。
 * @description 然后，移除每一行的公共前导空白。
 * @public
 * @param literals 字面值
 * @param interpolations 插入值
 * @returns 返回处理后的结果
 * @example
 * ```typescript
 * dedent` a\n b` // => 'a\nb'
 * ```
 */
export function dedent(
  literals: TemplateStringsArray,
  ...interpolations: Array<string | number>
): string;

/**
 * 首先，每一行紧跟前导空白的插入值为多行时，保持缩进。
 * 然后，移除每一行的公共前导空白。
 *
 * @public
 * @param literals 字面值
 * @param interpolations 插入值
 * @returns 返回处理后的结果
 * @example
 * ```typescript
 * dedent` a\n b` // => 'a\nb'
 * ```
 */
export function dedent(
  literals: TemplateStringsArray | string,
  ...interpolations: Array<string | number>
): string {
  const text = Array.isArray(literals)
    ? (() => {
        let result = "";
        for (let i = 0; i < interpolations.length; i++) {
          const literal = literals[i];
          let interpolation = interpolations[i];
          const match = literal.match(/(?:^|[\r\n]+)([^\S\r\n]*)$/);
          if (match && match[1]) {
            interpolation = String(interpolation).replace(
              /([\r\n]+)(?=[^\r\n])/g,
              `$1${match[1]}`
            );
          }
          result += literal;
          result += interpolation;
        }
        result += literals[literals.length - 1];
        return result;
      })()
    : (literals as string);

  // 公共的前导空白
  let commonLeadingWhitespace!: string;
  // 第一个非空行
  let firstLineIndex!: number;
  // 最后一个非空行
  let lastLineIndex!: number;

  const lines = text.split(/[\r\n]/g);

  for (let index = 0; index < lines.length; index++) {
    // 当前行的前导空白
    const leadingWhitespace = lines[index].match(/^\s*/)![0];
    // 如果当前行的前导空白等于当前行的长度，则认为这是一个空行，跳过
    if (leadingWhitespace.length !== lines[index].length) {
      lastLineIndex = index;
      if (firstLineIndex == null) {
        firstLineIndex = index;
      }
      if (
        commonLeadingWhitespace == null ||
        leadingWhitespace.length < commonLeadingWhitespace.length
      ) {
        commonLeadingWhitespace = leadingWhitespace;
      }
    }
  }

  return commonLeadingWhitespace == null
    ? text
    : lines
        .slice(firstLineIndex, lastLineIndex + 1)
        .map((line) => line.substr(commonLeadingWhitespace.length))
        .join("\n");
}

/**
 * @public
 */
export interface WaitResult<T> extends Promise<T> {
  /**
   * 取消等待，不执行后续逻辑。
   */
  cancel: () => void;
}

/**
 * @description 等待一段时间 resolve。
 * @public
 * @param milliseconds 等待时间(毫秒)
 * @param value resolve 值
 * @example
 * ```typescript
 * wait(1000).then(() => {
 *   console.log('ok')
 * }) // => 1秒后在控制台打印字符串: ok
 * ```
 */
export function wait<T>(milliseconds: number, value?: T): WaitResult<T> {
  let timer: any;
  const result = new Promise<T | undefined>((resolve) => {
    timer = setTimeout(() => resolve(value), milliseconds);
  }) as WaitResult<T>;
  result.cancel = () => clearTimeout(timer);
  return result;
}

/**
 * @description 等待一段时间后 reject。
 * @public
 * @param milliseconds 等待时间(毫秒)
 * @param value reject 值
 * @example
 * ```typescript
 * wait.reject(1000).catch(() => {
 *   console.log('ok')
 * }) // => 1秒后在控制台打印字符串: ok
 * ```
 */
wait.reject = function reject(
  milliseconds: number,
  value?: any
): WaitResult<never> {
  const waitRes = wait(milliseconds);
  const res: WaitResult<never> = waitRes.then(() =>
    Promise.reject(value)
  ) as any;
  res.cancel = waitRes.cancel;
  return res;
};

/**
 * 遍历对象和数组。
 *
 * @param value 要遍历的值
 * @param callback 遍历回调
 * @returns 返回结果
 * @example
 * ```typescript
 * traverse([1, 2, {3: 4}], value => {
 *   console.log(value)
 *   // => 1
 *   // => 2
 *   // => {3: 4}
 *   // => 4
 * })
 * ```
 */
export function traverse(
  value: any,
  callback: (value: any, key: string | number, parent: any) => any
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      callback(item, index, value);
      if (value[index] !== undefined) {
        traverse(item, callback);
      }
    });
  } else if (isPlainObject(value)) {
    forOwn(value, (item, key) => {
      callback(item, key, value);
      if (has(value, key)) {
        traverse(item, callback);
      }
    });
  }
}
