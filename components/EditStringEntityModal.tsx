import React, { useState, useEffect } from 'react';
import { StyleSheet, Modal, TouchableOpacity, KeyboardAvoidingView, Platform, I18nManager } from 'react-native';
import { Text, View, TextInput } from './Themed';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { ACCENT_GOLD } from '@/constants/Colors';
import { useTranslation } from '@/utils/i18n';

interface EditStringEntityModalProps {
  visible: boolean;
  entityType: 'Place' | 'Source';
  initialName: string;
  initialAliases: string[];
  onClose: () => void;
  onSubmit: (oldName: string, newName: string, aliases: string[]) => Promise<void>;
}

export default function EditStringEntityModal({ visible, entityType, initialName, initialAliases, onClose, onSubmit }: EditStringEntityModalProps) {
  const [name, setName] = useState(initialName);
  const [aliases, setAliases] = useState<string[]>(initialAliases);
  const [newAlias, setNewAlias] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    if (visible) {
      setName(initialName);
      setAliases([...initialAliases]);
      setNewAlias('');
      setIsSubmitting(false);
    }
  }, [visible, initialName, initialAliases]);

  const addAlias = () => {
    const trimmed = newAlias.trim();
    if (!trimmed) return;
    if (aliases.some(a => a.toLowerCase() === trimmed.toLowerCase())) return;
    if (trimmed.toLowerCase() === name.toLowerCase()) return;
    setAliases(prev => [...prev, trimmed]);
    setNewAlias('');
  };

  const removeAlias = (index: number) => {
    setAliases(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      alert(t('modals.entityNameRequired', { entityType: t(`modals.${entityType.toLowerCase()}`) }));
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(initialName, trimmedName, aliases);
      onClose();
    } catch (e) {
      console.error(e);
      alert(t('modals.updateEntityFailed', { entityType: t(`modals.${entityType.toLowerCase()}`) }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView 
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('modals.editEntityTitle', { entityType: t(`modals.${entityType.toLowerCase()}`) })}</Text>
            <TouchableOpacity onPress={onClose} disabled={isSubmitting}>
              <FontAwesome name="times" size={24} color="#888" />
            </TouchableOpacity>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>{t('modals.entityNameLabel', { entityType: t(`modals.${entityType.toLowerCase()}`) })}</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={`e.g. ${entityType === 'Place' ? 'Home' : 'Supermarket'}`}
              placeholderTextColor="#666"
              autoFocus
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>{t('modals.aliasesLabelPerson')}</Text>
            <Text style={styles.hint}>{t('modals.aliasesHintPerson')}</Text>
            
            <View style={styles.aliasList}>
              {aliases.map((alias, idx) => (
                <View key={idx} style={styles.aliasRow}>
                  <Text style={styles.aliasText}>{alias}</Text>
                  <TouchableOpacity onPress={() => removeAlias(idx)} style={styles.removeAliasBtn}>
                    <FontAwesome name="times-circle" size={18} color="#ff4444" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>

            <View style={styles.addAliasRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={newAlias}
                onChangeText={setNewAlias}
                placeholder={t('modals.addAliasPlaceholderPerson')}
                placeholderTextColor="#666"
                onSubmitEditing={addAlias}
                returnKeyType="done"
              />
              <TouchableOpacity
                style={[styles.addAliasBtn, !newAlias.trim() && { opacity: 0.4 }]}
                onPress={addAlias}
                disabled={!newAlias.trim()}>
                <FontAwesome name="plus" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={isSubmitting}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSubmit} disabled={isSubmitting}>
              <Text style={styles.saveText}>{isSubmitting ? t('modals.saving') : t('modals.saveChanges')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    borderRadius: 15,
    padding: 20,
    borderWidth: 1,
    borderColor: '#333',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  formGroup: {
    marginBottom: 15,
  },
  label: {
    fontSize: 14,
    color: '#aaa',
    marginBottom: 5,
    marginTop: 10,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  input: {
    backgroundColor: '#333',
    color: '#fff',
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
  },
  hint: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
    fontStyle: 'italic',
  },
  aliasList: {
    marginBottom: 5,
  },
  aliasRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#333',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 5,
  },
  aliasText: {
    color: '#fff',
    fontSize: 15,
  },
  removeAliasBtn: {
    padding: 4,
  },
  addAliasRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  addAliasBtn: {
    backgroundColor: ACCENT_GOLD,
    padding: 12,
    borderRadius: 8,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 15,
    marginTop: 10,
  },
  cancelBtn: {
    padding: 12,
  },
  cancelText: {
    color: '#888',
    fontSize: 16,
    fontWeight: 'bold',
  },
  saveBtn: {
    backgroundColor: ACCENT_GOLD,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  saveText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
