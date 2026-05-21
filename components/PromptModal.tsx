import React, { useState, useEffect } from 'react';
import { StyleSheet, Modal, View, TouchableOpacity, I18nManager, Pressable } from 'react-native';
import { Text, TextInput } from '@/components/Themed';
import { useTranslation } from '@/utils/i18n';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { ACCENT_GOLD } from '@/constants/Colors';

interface PromptModalProps {
  visible: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'phone-pad';
  showToggle?: boolean;
  toggleLabel?: string;
  onCancel: () => void;
  onSubmit: (value: string, toggleValue: boolean) => void;
}

export default function PromptModal({
  visible,
  title,
  message,
  placeholder,
  defaultValue = '',
  keyboardType = 'default',
  showToggle,
  toggleLabel,
  onCancel,
  onSubmit,
}: PromptModalProps) {
  const [value, setValue] = useState(defaultValue);
  const [toggleActive, setToggleActive] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    if (visible) {
      setValue(defaultValue);
      setToggleActive(false);
    }
  }, [visible, defaultValue]);

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <TextInput
            style={styles.input}
            placeholder={placeholder}
            placeholderTextColor="#888"
            value={value}
            onChangeText={setValue}
            keyboardType={keyboardType}
            autoFocus
          />

          {showToggle && (
            <Pressable 
              style={styles.toggleRow} 
              onPress={() => setToggleActive(!toggleActive)}
            >
              <FontAwesome 
                name={toggleActive ? 'check-square-o' : 'square-o'} 
                size={20} 
                color={toggleActive ? ACCENT_GOLD : '#888'} 
              />
              <Text style={styles.toggleLabel}>{toggleLabel}</Text>
            </Pressable>
          )}

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.submitBtn}
              onPress={() => {
                onSubmit(value, toggleActive);
                setValue('');
                setToggleActive(false);
              }}>
              <Text style={styles.submitBtnText}>{t('modals.submit')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  dialog: {
    backgroundColor: '#222',
    width: '100%',
    borderRadius: 12,
    padding: 20,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
  message: {
    fontSize: 16,
    color: '#ccc',
    marginBottom: 15,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
  input: {
    backgroundColor: '#333',
    color: '#fff',
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#444',
    marginBottom: 15,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 8,
  },
  cancelBtnText: {
    color: '#ccc',
    fontSize: 16,
    fontWeight: '600',
  },
  submitBtn: {
    backgroundColor: ACCENT_GOLD,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
    marginTop: 5,
  },
  toggleLabel: {
    color: '#ccc',
    fontSize: 14,
    flex: 1,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
});
