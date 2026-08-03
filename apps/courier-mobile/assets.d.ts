declare module '*.png' {
  // Ambient asset declarations cannot use a top-level type import.
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const source: import('react-native').ImageSourcePropType;
  export default source;
}
