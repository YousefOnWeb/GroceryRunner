/**
 * Learn more about Light and Dark modes:
 * https://docs.expo.io/guides/color-schemes/
 */

import React, { forwardRef } from 'react';
import { Text as DefaultText, View as DefaultView, TextInput as DefaultTextInput, StyleSheet } from 'react-native';

import Colors from '@/constants/Colors';
import { useColorScheme } from './useColorScheme';
import { useSettings } from '@/utils/settings';

type ThemeProps = {
  lightColor?: string;
  darkColor?: string;
};

export type TextProps = ThemeProps & DefaultText['props'];
export type ViewProps = ThemeProps & DefaultView['props'];
export type TextInputProps = ThemeProps & DefaultTextInput['props'];

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof typeof Colors.light & keyof typeof Colors.dark
) {
  const theme = useColorScheme() ?? 'light';
  const colorFromProps = props[theme];

  if (colorFromProps) {
    return colorFromProps;
  } else {
    return Colors[theme][colorName];
  }
}

const mapFontWeightToEstedad = (fontWeight: any): string => {
  if (!fontWeight) return 'Estedad-Regular';
  const weight = String(fontWeight).toLowerCase();
  switch (weight) {
    case '100':
    case 'thin':
      return 'Estedad-Thin';
    case '200':
    case 'extra-light':
    case 'extralight':
      return 'Estedad-ExtraLight';
    case '300':
    case 'light':
      return 'Estedad-Light';
    case '400':
    case 'normal':
    case 'regular':
      return 'Estedad-Regular';
    case '500':
    case 'medium':
      return 'Estedad-Medium';
    case '600':
    case 'semi-bold':
    case 'semibold':
      return 'Estedad-SemiBold';
    case '700':
    case 'bold':
      return 'Estedad-Bold';
    case '800':
    case 'extra-bold':
    case 'extrabold':
      return 'Estedad-ExtraBold';
    case '900':
    case 'black':
      return 'Estedad-Black';
    default:
      return 'Estedad-Regular';
  }
};

const toArabicNumeralsAndCommas = (text: string): string => {
  return text
    .replace(/[0-9]/g, (w) => '٠١٢٣٤٥٦٧٨٩'[+w])
    .replace(/,/g, '،');
};

const toEnglishNumerals = (text: string, isNumeric: boolean): string => {
  let res = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (isNumeric) {
    res = res.replace(/[،,]/g, '.');
  } else {
    res = res.replace(/،/g, ',');
  }
  return res;
};

const translateChildren = (children: any, isArabic: boolean): any => {
  if (!isArabic) return children;
  if (typeof children === 'string') {
    return toArabicNumeralsAndCommas(children);
  }
  if (typeof children === 'number') {
    return toArabicNumeralsAndCommas(String(children));
  }
  if (Array.isArray(children)) {
    return children.map((child) => translateChildren(child, isArabic));
  }
  return children;
};

export const Text = forwardRef<DefaultText, TextProps>((props, ref) => {
  const { style, lightColor, darkColor, children, ...otherProps } = props;
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text');
  const { settings } = useSettings();
  const isArabic = settings?.language === 'ar';

  // Flatten styles to inspect fontFamily and fontWeight
  const flatStyle = StyleSheet.flatten(style) || {};

  const customStyle: any = {};
  if (!flatStyle.fontFamily) {
    customStyle.fontFamily = mapFontWeightToEstedad(flatStyle.fontWeight);
    customStyle.fontWeight = 'normal'; // bypass synthetic double bolding on React Native custom fonts
    if (flatStyle.fontStyle === 'italic') {
      customStyle.fontStyle = 'normal'; // override italic to prevent fallback to system font
    }
  }

  const translated = translateChildren(children, isArabic);

  return <DefaultText ref={ref} style={[{ color }, style, customStyle]} {...otherProps}>{translated}</DefaultText>;
});

export const TextInput = forwardRef<DefaultTextInput, TextInputProps>((props, ref) => {
  const { style, lightColor, darkColor, value, onChangeText, defaultValue, keyboardType, ...otherProps } = props;
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text');
  const placeholderColor = useThemeColor({ light: lightColor, dark: darkColor }, 'tabIconDefault');
  const { settings } = useSettings();
  const isArabic = settings?.language === 'ar';

  const isNumeric = keyboardType === 'numeric' || keyboardType === 'decimal-pad';

  const flatStyle = StyleSheet.flatten(style) || {};

  const customStyle: any = {};
  if (!flatStyle.fontFamily) {
    customStyle.fontFamily = mapFontWeightToEstedad(flatStyle.fontWeight);
    customStyle.fontWeight = 'normal';
    if (flatStyle.fontStyle === 'italic') {
      customStyle.fontStyle = 'normal';
    }
  }

  const displayValue = value !== undefined
    ? (isArabic ? toArabicNumeralsAndCommas(String(value)) : String(value))
    : undefined;

  const displayDefaultValue = defaultValue !== undefined
    ? (isArabic ? toArabicNumeralsAndCommas(String(defaultValue)) : String(defaultValue))
    : undefined;

  const handleTextChange = (text: string) => {
    if (onChangeText) {
      onChangeText(toEnglishNumerals(text, isNumeric));
    }
  };

  return (
    <DefaultTextInput
      ref={ref}
      value={displayValue}
      defaultValue={displayDefaultValue}
      onChangeText={handleTextChange}
      placeholderTextColor={props.placeholderTextColor ?? placeholderColor}
      style={[{ color }, style, customStyle]}
      keyboardType={keyboardType}
      {...otherProps}
    />
  );
});

export const View = forwardRef<DefaultView, ViewProps>((props, ref) => {
  const { style, lightColor, darkColor, ...otherProps } = props;
  const backgroundColor = useThemeColor({ light: lightColor, dark: darkColor }, 'background');

  return <DefaultView ref={ref} style={[{ backgroundColor }, style]} {...otherProps} />;
});
