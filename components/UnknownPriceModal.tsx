import { Text } from '@/components/Themed';
import { ACCENT_GOLD } from '@/constants/Colors';
import { api } from '@/db/api';
import { useTranslation } from '@/utils/i18n';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

interface UnknownPriceModalProps {
  visible: boolean;
  personId: string | null;
  personName: string;
  onClose: () => void;
}

export default function UnknownPriceModal({
  visible,
  personId,
  personName,
  onClose,
}: UnknownPriceModalProps) {
  const [items, setItems] = useState<{ itemName: string; quantity: number; orderDate: string }[]>([]);
  const { t } = useTranslation();

  useEffect(() => {
    if (visible && personId) {
      api.getUnpaidUnknownPriceItems(personId).then(setItems);
    }
  }, [visible, personId]);

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('modals.unknownPriceTitle', { name: personName })}</Text>
            <TouchableOpacity onPress={onClose}>
              <FontAwesome name="times" size={24} color="#aaa" />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>
            {t('modals.unknownPriceSubtitle')}
          </Text>

          <ScrollView style={styles.list}>
            {items.map((item, idx) => (
              <View key={idx} style={styles.itemRow}>
                <View style={styles.dot} />
                <View style={styles.quantityBadge}>
                  <Text style={[
                    styles.quantityText,
                    item.quantity > 1 && styles.quantityTextMultiple
                  ]}>{item.quantity}x</Text>
                </View>
                <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.itemText, { flexShrink: 1, marginStart: 8 }]}>
                  {item.itemName}
                </Text>
                <Text style={[styles.dateText, { flexShrink: 0 }]}>{item.orderDate}</Text>
              </View>
            ))}
            {items.length === 0 && (
              <Text style={styles.emptyText}>{t('modals.noUnknownItems')}</Text>
            )}
          </ScrollView>

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>{t('modals.gotIt')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  dialog: {
    backgroundColor: '#222',
    width: '100%',
    borderRadius: 12,
    padding: 20,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#ccc',
    lineHeight: 20,
    marginBottom: 20,
  },
  list: {
    marginBottom: 20,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ff9800',
    marginEnd: 10,
  },
  itemText: {
    fontSize: 16,
    color: '#fff',
    flex: 1,
  },
  quantityBadge: {
    backgroundColor: '#333',
    paddingHorizontal: 6,
    paddingVertical: 0,
    borderRadius: 4,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quantityText: {
    color: '#ccc',
    fontWeight: '500',
    fontSize: 13,
    lineHeight: 13,
  },
  quantityTextMultiple: {
    fontWeight: '900',
  },
  dateText: {
    fontSize: 12,
    color: '#666',
    marginStart: 10,
  },
  emptyText: {
    color: '#666',
    fontStyle: 'italic',
    textAlign: 'center',
  },
  closeBtn: {
    backgroundColor: ACCENT_GOLD,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  closeBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});
