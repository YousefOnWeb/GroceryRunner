import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, StyleProp, ViewStyle, Platform, UIManager, I18nManager } from 'react-native';
import { Text, TextInput, TextInputProps } from './Themed';
import { findSmartSuggestion } from '@/utils/textMatching';
import FontAwesome from '@expo/vector-icons/FontAwesome';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface SmartTextInputProps extends TextInputProps {
  corpus?: string[];
  containerStyle?: StyleProp<ViewStyle>;
  compactMode?: boolean;
}

export default function SmartTextInput({ 
  value, 
  onChangeText, 
  corpus = [], 
  containerStyle, 
  compactMode,
  style,
  ...props 
}: SmartTextInputProps) {
  const [suggestion, setSuggestion] = useState<string | null>(null);

  useEffect(() => {
    // Debounce the suggestion check slightly to avoid checking on every keystroke instantly
    const timer = setTimeout(() => {
      if (value) {
        const found = findSmartSuggestion(value, corpus);
        setSuggestion(found);
      } else {
        setSuggestion(null);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [value, corpus]);

  const handleApplySuggestion = () => {
    if (suggestion && onChangeText) {
      onChangeText(suggestion);
      setSuggestion(null);
    }
  };

  return (
    <View style={containerStyle}>
      <TextInput
        value={value}
        onChangeText={(text) => {
          if (onChangeText) onChangeText(text);
          // Hide suggestion immediately when typing starts again to feel responsive
          if (suggestion) setSuggestion(null);
        }}
        style={style}
        {...props}
      />
      {suggestion && (
        <TouchableOpacity 
          style={[styles.suggestionBubble, compactMode && styles.suggestionBubbleCompact]} 
          onPress={handleApplySuggestion}
          activeOpacity={0.7}
        >
          <FontAwesome name="magic" size={compactMode ? 10 : 12} color="#f0ad4e" style={styles.icon} />
          <Text style={[styles.suggestionText, compactMode && styles.textCompact]}>
            Did you mean: <Text style={styles.suggestionHighlight}>{suggestion}</Text>?
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  suggestionBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(240, 173, 78, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(240, 173, 78, 0.4)',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginTop: -8, // Pull it slightly up to sit snugly under the input
    marginBottom: 8,
    marginStart: 4,
  },
  suggestionBubbleCompact: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: -4,
    marginBottom: 4,
  },
  icon: {
    marginEnd: 6,
  },
  suggestionText: {
    color: '#ccc',
    fontSize: 12,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  suggestionHighlight: {
    color: '#f0ad4e',
    fontWeight: 'bold',
  },
  textCompact: {
    fontSize: 11,
  },
});
