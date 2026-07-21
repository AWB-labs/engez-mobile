// babel-preset-expo (SDK 54+) auto-configures react-native-worklets/plugin
// when react-native-reanimated is installed, so it must not be added by hand.
module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
