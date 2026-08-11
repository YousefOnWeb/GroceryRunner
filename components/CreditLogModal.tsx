import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, TouchableOpacity, View, ActivityIndicator, I18nManager } from 'react-native';
import { Text } from './Themed';
import { db } from '@/db';
import { persons } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { api } from '@/db/api';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useSettings } from '@/utils/settings';
import { useTranslation } from '@/utils/i18n';
import { ACCENT_GOLD } from '@/constants/Colors';

interface CreditLogModalProps {
  visible: boolean;
  personId: string;
  personName: string;
  onClose: () => void;
}

export default function CreditLogModal({ visible, personId, personName, onClose }: CreditLogModalProps) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { settings } = useSettings();
  const { t, isRTL } = useTranslation();

  useEffect(() => {
    if (visible && personId) {
      loadLogs();
    }
  }, [visible, personId]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const data = await api.getTransactionsForPerson(personId);
      const personData = await db.select({ balance: persons.balance }).from(persons).where(eq(persons.id, personId));
      let currentBal = personData.length > 0 ? personData[0].balance : 0;
      
      const logsWithBalance = data.map(log => {
        const after = currentBal;
        const before = currentBal - log.amount;
        currentBal = before;
        return { ...log, balanceBefore: before, balanceAfter: after };
      });
      
      setLogs(logsWithBalance);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (isoString: string) => {
    const d = new Date(isoString);
    const weekdays = t('modals.daysShort').split(',');
    const day = weekdays[d.getDay()];
    // For locale-aware date/time formatting
    const locale = isRTL ? 'ar' : 'en-US';
    const date = d.toLocaleDateString(locale);
    const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    return `\u2066${day}, ${date} ${time}\u2069`;
  };

  const getAmountColor = (amount: number) => {
    // Negative or zero means credit/settled (Green). Positive means debt (Red).
    return amount <= 0 ? '#00C851' : '#ff4444';
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={[styles.dialog, settings.compactMode && styles.dialogCompact]}>
          <View style={styles.header}>
            <Text style={[styles.title, settings.compactMode && styles.titleCompact]}>{t('modals.creditLogTitle', { name: personName })}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <FontAwesome name="times" size={20} color="#888" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator size="large" color={ACCENT_GOLD} style={{ margin: 20 }} />
          ) : (
            <ScrollView style={styles.logList} contentContainerStyle={styles.logListContent}>
              {logs.map((log) => {
                const dispAmount = -log.amount;
                const dispBalBefore = -log.balanceBefore;
                const dispBalAfter = -log.balanceAfter;
                return (
                  <View key={log.id} style={[styles.logItem, settings.compactMode && styles.logItemCompact]}>
                    <View style={styles.logTop}>
                      <Text style={[styles.logDate, settings.compactMode && styles.textExtraSmall]}>
                        {formatDateTime(log.date)}
                      </Text>
                      <Text style={[styles.logAmount, { color: getAmountColor(log.amount) }, settings.compactMode && styles.textSmall]}>
                        {dispAmount >= 0 ? '+' : ''}{dispAmount.toFixed(2)}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <Text style={[styles.logNote, settings.compactMode && styles.textSmall, { flex: 1, marginEnd: 10 }]}>{log.note || log.type}</Text>
                      
                      <View style={styles.balanceBadge}>
                        <Text style={[styles.balanceText, { color: getAmountColor(log.balanceBefore) }]}>
                          {dispBalBefore >= 0 ? '+' : ''}{dispBalBefore.toFixed(2)}
                        </Text>
                        <FontAwesome name={isRTL ? "long-arrow-left" : "long-arrow-right"} size={10} color="#888" style={{ marginHorizontal: 6 }} />
                        <Text style={[styles.balanceText, { color: getAmountColor(log.balanceAfter) }]}>
                          {dispBalAfter >= 0 ? '+' : ''}{dispBalAfter.toFixed(2)}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
              {logs.length === 0 && (
                <Text style={styles.emptyText}>{t('modals.noTransactions')}</Text>
              )}
            </ScrollView>
          )}
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
    maxHeight: '80%',
    borderRadius: 12,
    padding: 20,
    elevation: 10,
  },
  dialogCompact: { padding: 12 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff', textAlign: I18nManager.isRTL ? 'right' : 'left' },
  titleCompact: { fontSize: 16 },
  closeBtn: { padding: 5 },
  logList: { flexGrow: 0 },
  logListContent: { paddingBottom: 10 },
  logItem: {
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    paddingVertical: 12,
  },
  logItemCompact: { paddingVertical: 8 },
  logTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  logDate: { color: '#888', fontSize: 12, textAlign: I18nManager.isRTL ? 'right' : 'left' },
  logAmount: { fontWeight: 'bold', fontSize: 16 },
  logNote: { color: '#eee', fontSize: 14, textAlign: I18nManager.isRTL ? 'right' : 'left' },
  balanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#333',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#444',
  },
  balanceText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  emptyText: { color: '#666', textAlign: 'center', marginTop: 20, fontStyle: 'italic' },
  textSmall: { fontSize: 13 },
  textExtraSmall: { fontSize: 11 },
});
