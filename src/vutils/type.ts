/**
 * @description 去除类型 T 中的 undefined。
 * @public
 * @example
 * ```typescript
 * type X = string | undefined
 * type Y = Defined<X> // => string
 * ```
 */
export type Defined<T> = Exclude<T, undefined>;

/**
 * @description 同 `T | T[]`。
 * @public
 * @example
 * ```typescript
 * type X = OneOrMore<number> // => number | number[]
 * ```
 */
export type OneOrMore<T> = T | T[];

export type {
  AnyArray,
  ValueOf,
  ElementOf,
  AsyncOrSync,
  Buildable,
  Writable,
  Merge,
  Head,
  Tail,
  PickProperties as PickBy,
  OmitProperties as OmitBy,
  MarkOptional as PartialBy,
  MarkRequired as RequiredBy,
  StrictOmit as OmitStrict,
  DeepOmit as OmitDeep,
  DeepReadonly as ReadonlyDeep,
  DeepPartial as PartialDeep,
  DeepRequired as RequiredDeep,
  DeepWritable as WritableDeep,
  DeepNullable as NullableDeep,
  DeepNonNullable as NonNullableDeep,
  ReadonlyKeys,
  WritableKeys,
  OptionalKeys,
  RequiredKeys,
  XOR,
} from "ts-essentials";

export type {
  LiteralUnion,
  AsyncReturnType,
  FixedLengthArray,
  PackageJson,
  TsConfigJson,
  JsonValue,
  JsonArray,
  JsonObject,
  CamelCase,
  SnakeCase,
  KebabCase,
  PascalCase,
  DelimiterCase,
  ScreamingSnakeCase as ConstantCase,
  Class,
  Asyncify,
  UnionToIntersection,
  UnionToTuple,
  Integer,
  NegativeInteger,
  NonNegativeInteger,
  Negative,
  NonNegative,
  Finite,
  PositiveInfinity,
  NegativeInfinity,
  Simplify,
  RequireAtLeastOne,
  RequireExactlyOne,
  RequireAllOrNone,
  SetRequiredDeep as RequiredDeepBy,
} from "type-fest";
