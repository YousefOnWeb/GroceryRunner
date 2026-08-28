import { ACCENT_GOLD } from '@/constants/Colors';
import { useTranslation } from '@/utils/i18n';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, I18nManager, Modal, StyleSheet, Switch, TouchableOpacity } from 'react-native';
import { Text, View } from './Themed';

interface Entity {
  id: string;
  name: string;
  details?: string; // e.g. "Balance: EGP 50" or "Source: Supermarket"
}

interface MergeModalProps {
  visible: boolean;
  entityA: Entity | null;
  entityB: Entity | null;
  entityType: 'Person' | 'Item' | 'Place' | 'Source';
  onClose: () => void;
  onConfirm: (primaryId: string, secondaryId: string, keepAsAlias: boolean) => Promise<void>;
}

export default function MergeModal({ visible, entityA, entityB, entityType, onClose, onConfirm }: MergeModalProps) {
  const [primaryId, setPrimaryId] = useState<string>('');
  const [keepAsAlias, setKeepAsAlias] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { t } = useTranslation();

  // Default primary to A
  useEffect(() => {
    if (visible && entityA) {
      setPrimaryId(entityA.id);
      setKeepAsAlias(true);
      setIsSubmitting(false);
    }
  }, [visible, entityA]);

  if (!entityA || !entityB) return null;

  const isAPrimary = primaryId === entityA.id;
  const primary = isAPrimary ? entityA : entityB;
  const secondary = isAPrimary ? entityB : entityA;

  const handleSwap = () => {
    setPrimaryId(isAPrimary ? entityB.id : entityA.id);
  };

  const handleMerge = async () => {
    setIsSubmitting(true);
    try {
      await onConfirm(primary.id, secondary.id, keepAsAlias);
      onClose();
    } catch (e) {
      console.error(e);
      // Handle error if needed
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('modals.mergeTitle', { type: t(`modals.${entityType.toLowerCase()}`) })}</Text>
            <TouchableOpacity onPress={onClose} disabled={isSubmitting}>
              <FontAwesome name="times" size={24} color="#888" />
            </TouchableOpacity>
          </View>

          <Text style={styles.description}>
            {t('modals.mergeDesc', { type: t(`modals.${entityType.toLowerCase()}`) })}
          </Text>

          <View style={styles.swapContainer}>
            <View style={[styles.entityBox, styles.primaryBox]}>
              <Text style={styles.roleLabel}>{t('modals.primaryLabel')}</Text>
              <Text style={styles.entityName}>{primary.name}</Text>
              {primary.details && <Text style={styles.entityDetails}>{primary.details}</Text>}
            </View>

            <TouchableOpacity style={styles.swapBtn} onPress={handleSwap} disabled={isSubmitting}>
              <FontAwesome name="exchange" size={20} color="#fff" style={{ transform: [{ rotate: '90deg' }] }} />
            </TouchableOpacity>

            <View style={[styles.entityBox, styles.secondaryBox]}>
              <Text style={styles.roleLabel}>{t('modals.secondaryLabel')}</Text>
              <Text style={[styles.entityName, styles.strikethrough]}>{secondary.name}</Text>
              {secondary.details && <Text style={styles.entityDetails}>{secondary.details}</Text>}
            </View>
          </View>

          <View style={styles.optionRow}>
            <Text style={styles.optionLabel}>{t('modals.keepAsAlias', { secondary: secondary.name, primary: primary.name })}</Text>
            <Switch
              value={keepAsAlias}
              onValueChange={setKeepAsAlias}
              trackColor={{ false: '#767577', true: '#81b0ff' }}
              thumbColor={keepAsAlias ? ACCENT_GOLD : '#f4f3f4'}
              disabled={isSubmitting}
            />
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={isSubmitting}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.mergeBtn} onPress={handleMerge} disabled={isSubmitting}>
              {isSubmitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.mergeText}>{t('modals.confirmMerge')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
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
    marginBottom: 15,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  description: {
    color: '#ccc',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  swapContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  entityBox: {
    width: '100%',
    padding: 15,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
  },
  primaryBox: {
    borderColor: '#00C851',
    backgroundColor: 'rgba(0, 200, 81, 0.1)',
  },
  secondaryBox: {
    borderColor: '#ff4444',
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
  },
  roleLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    marginBottom: 5,
    color: '#888',
  },
  entityName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  entityDetails: {
    fontSize: 14,
    color: '#aaa',
    marginTop: 4,
  },
  strikethrough: {
    textDecorationLine: 'line-through',
    color: '#888',
  },
  swapBtn: {
    backgroundColor: '#333',
    padding: 10,
    borderRadius: 20,
    marginVertical: -15,
    zIndex: 10,
    borderWidth: 2,
    borderColor: '#1a1a1a',
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#222',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
  },
  optionLabel: {
    color: '#fff',
    flex: 1,
    marginEnd: 15,
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 15,
  },
  cancelBtn: {
    padding: 12,
  },
  cancelText: {
    color: '#888',
    fontSize: 16,
    fontWeight: 'bold',
  },
  mergeBtn: {
    backgroundColor: '#ff4444',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    minWidth: 130,
    alignItems: 'center',
  },
  mergeText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
