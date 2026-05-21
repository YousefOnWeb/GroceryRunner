import React, { useState } from 'react';
import { Modal, StyleSheet, TouchableOpacity, View, ScrollView } from 'react-native';
import { Text, TextInput } from '@/components/Themed';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { ACCENT_GOLD } from '@/constants/Colors';

interface DropdownSelectProps {
  label?: string;
  value: string;
  options: string[];
  onSelect: (value: string) => void;
  placeholder?: string;
  allowCustom?: boolean;
}

export default function DropdownSelect({
  label,
  value,
  options,
  onSelect,
  placeholder = 'Select an option...',
  allowCustom = false,
}: DropdownSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [customValue, setCustomValue] = useState('');

  return (
    <>
      <TouchableOpacity style={styles.trigger} onPress={() => setIsOpen(true)}>
        <Text style={[styles.triggerText, !value && styles.placeholder]}>
          {value || placeholder}
        </Text>
        <FontAwesome name="chevron-down" size={14} color="#888" />
      </TouchableOpacity>

      <Modal visible={isOpen} transparent animationType="fade">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setIsOpen(false)}>
          <View style={styles.dialog}>
            {label && <Text style={styles.title}>{label}</Text>}
            <ScrollView style={styles.optionsList}>
              {options.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={styles.option}
                  onPress={() => {
                    onSelect(opt);
                    setIsOpen(false);
                  }}>
                  <Text style={[styles.optionText, value === opt && styles.optionSelected]}>
                    {opt}
                  </Text>
                  {value === opt && <FontAwesome name="check" size={16} color={ACCENT_GOLD} />}
                </TouchableOpacity>
              ))}
            </ScrollView>

            {allowCustom && (
              <View style={styles.customContainer}>
                <TextInput
                  style={styles.customInput}
                  placeholder="Or enter custom value..."
                  placeholderTextColor="#888"
                  value={customValue}
                  onChangeText={setCustomValue}
                />
                <TouchableOpacity
                  style={styles.customBtn}
                  onPress={() => {
                    if (customValue.trim()) {
                      onSelect(customValue.trim());
                      setIsOpen(false);
                      setCustomValue('');
                    }
                  }}>
                  <Text style={styles.customBtnText}>Use</Text>
                </TouchableOpacity>
              </View>
            )}
            
            <TouchableOpacity style={styles.closeBtn} onPress={() => setIsOpen(false)}>
              <Text style={styles.closeBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    backgroundColor: '#333',
    padding: 12,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#444',
  },
  triggerText: {
    color: '#fff',
    fontSize: 16,
  },
  placeholder: {
    color: '#888',
  },
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
    maxHeight: '80%',
    borderRadius: 12,
    padding: 20,
    elevation: 5,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 15,
  },
  optionsList: {
    maxHeight: 300,
  },
  option: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  optionText: {
    fontSize: 16,
    color: '#ccc',
  },
  optionSelected: {
    color: ACCENT_GOLD,
    fontWeight: 'bold',
  },
  customContainer: {
    flexDirection: 'row',
    marginTop: 15,
    gap: 10,
  },
  customInput: {
    flex: 1,
    backgroundColor: '#333',
    color: '#fff',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#444',
  },
  customBtn: {
    backgroundColor: ACCENT_GOLD,
    justifyContent: 'center',
    paddingHorizontal: 15,
    borderRadius: 8,
  },
  customBtnText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  closeBtn: {
    marginTop: 20,
    alignItems: 'center',
    paddingVertical: 10,
  },
  closeBtnText: {
    color: '#ff4444',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
