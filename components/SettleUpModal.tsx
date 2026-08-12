import React, { useState, useEffect } from 'react';
import { Modal, StyleSheet, TouchableOpacity, View, TextInput, KeyboardAvoidingView, Platform, I18nManager } from 'react-native';
import { Text } from './Themed';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useSettings } from '@/utils/settings';
import { useTranslation } from '@/utils/i18n';
import { ACCENT_GOLD, LIGHT_GOLD } from '@/constants/Colors';

interface SettleUpModalProps {
  visible: boolean;
  personId: string;
  personName: string;
  currentBalance: number;
  orderId?: string;
  onClose: () => void;
  onSubmit: (amount: number, note: string, markSettled?: boolean, markAllPastSettled?: boolean) => void;
}

export default function SettleUpModal({ visible, personId, personName, currentBalance, orderId, onClose, onSubmit }: SettleUpModalProps) {
  const { settings } = useSettings();
  const { t, isRTL } = useTranslation();
  
  // Smart default: If balance < 0 (they owe money), auto-fill it. Otherwise 0.
  const defaultAmount = currentBalance < 0 ? Math.abs(currentBalance) : 0;
  const [amountStr, setAmountStr] = useState(defaultAmount.toFixed(2));
  const [note, setNote] = useState('');
  const [markSettled, setMarkSettled] = useState(false);
  const [markAllPastSettled, setMarkAllPastSettled] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (visible) {
      setAmountStr(currentBalance < 0 ? Math.abs(currentBalance).toFixed(2) : '');
      setNote('');
      setMarkSettled(false);
      setMarkAllPastSettled(false);
      setErrorMsg('');
    }
  }, [visible, currentBalance]);

  const parsedAmount = parseFloat(amountStr) || 0;
  const newBalance = currentBalance + parsedAmount;

  // The confirmation message string based on inputs
  const isCredit = newBalance > 0;
  const absNewBalance = Math.abs(newBalance).toFixed(2);
  
  // Translation fallback logic
  const tReceivePaymentTitle = t('run.receivePaymentTitle') || (isRTL ? 'استلام دفعة' : 'Receive Payment');
  const tAmountLabel = t('run.paymentAmountLabel') || (isRTL ? 'المبلغ المستلم' : 'Amount Received');
  const tCancel = t('common.cancel') || (isRTL ? 'إلغاء' : 'Cancel');
  const tSave = t('common.save') || (isRTL ? 'حفظ' : 'Save');
  
  const renderConfirmation = () => {
    if (parsedAmount <= 0) return null;
    
    let baseMsg = isRTL 
      ? `استلام مبلغ $${parsedAmount.toFixed(2)} من ${personName}. `
      : `Receiving $${parsedAmount.toFixed(2)} from ${personName}. `;
      
    if (Math.abs(newBalance) < 0.01) {
      baseMsg += isRTL ? 'سيتم تصفية رصيدها/رصيده (0.00$).' : 'Their new balance will be settled ($0.00).';
    } else if (isCredit) {
      baseMsg += isRTL ? `سيصبح رصيدها/رصيده الجديد $${absNewBalance} (لها/له).` : `Their new balance will be $${absNewBalance} (Credit).`;
    } else {
      baseMsg += isRTL ? `سيصبح رصيدها/رصيده الجديد $${absNewBalance} (دين).` : `Their new balance will be $${absNewBalance} (Debt).`;
    }
    
    return (
      <View style={styles.confirmBox}>
        <FontAwesome name="info-circle" size={16} color="#00C851" style={{ marginTop: 2 }} />
        <Text style={[styles.confirmText, { textAlign: isRTL ? 'right' : 'left' }]}>
          {baseMsg}
        </Text>
      </View>
    );
  };

  const handleSave = () => {
    if (parsedAmount <= 0) return;
    if (note.trim().length === 0) {
      setErrorMsg(t('run.noteMandatory') || (isRTL ? 'الملاحظة مطلوبة' : 'Note/Description is mandatory'));
      return;
    }
    setErrorMsg('');
    onSubmit(parsedAmount, note.trim(), orderId ? markSettled : undefined, orderId ? markAllPastSettled : undefined);
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={[styles.dialog, settings.compactMode && styles.dialogCompact]}>
          <View style={styles.header}>
            <Text style={[styles.title, settings.compactMode && styles.titleCompact]}>{tReceivePaymentTitle}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <FontAwesome name="times" size={20} color="#888" />
            </TouchableOpacity>
          </View>

          <Text style={[styles.label, { textAlign: isRTL ? 'right' : 'left' }, settings.compactMode && styles.labelCompact]}>
            {tAmountLabel}
          </Text>
          <View style={styles.inputContainer}>
            <Text style={styles.currencySymbol}>$</Text>
            <TextInput
              style={[styles.input, { textAlign: isRTL ? 'right' : 'left' }, settings.compactMode && styles.inputCompact]}
              value={amountStr}
              onChangeText={setAmountStr}
              keyboardType="numeric"
              autoFocus
              selectionColor={ACCENT_GOLD}
            />
          </View>

          <Text style={[styles.label, { textAlign: isRTL ? 'right' : 'left' }, settings.compactMode && styles.labelCompact]}>
            {t('run.receivePaymentNote')}
          </Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={[styles.input, { textAlign: isRTL ? 'right' : 'left' }, settings.compactMode && styles.inputCompact]}
              value={note}
              onChangeText={(t) => {
                setNote(t);
                if (errorMsg) setErrorMsg('');
              }}
              placeholder={t('run.receivePaymentNote')}
              placeholderTextColor="#888"
              selectionColor={ACCENT_GOLD}
            />
          </View>
          {!!errorMsg && (
            <Text style={{ color: '#ff4444', fontSize: 12, marginTop: -10, marginBottom: 10, textAlign: isRTL ? 'right' : 'left' }}>
              {errorMsg}
            </Text>
          )}
          
          {orderId && (
            <View style={{ marginTop: 5 }}>
              <TouchableOpacity 
                style={[styles.checkboxContainer, markAllPastSettled && { opacity: 0.5 }]} 
                onPress={() => {
                  if (markAllPastSettled) return;
                  setMarkSettled(!markSettled);
                }}
                activeOpacity={markAllPastSettled ? 1 : 0.7}
              >
                <FontAwesome name={markSettled ? "check-square" : "square-o"} size={20} color={markSettled ? ACCENT_GOLD : "#888"} />
                <Text style={[styles.checkboxLabel, { textAlign: isRTL ? 'right' : 'left' }, settings.compactMode && styles.textSmall]}>
                  {t('run.markOrderSettled')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.checkboxContainer, { marginTop: 8 }, markSettled && { opacity: 0.5 }]} 
                onPress={() => {
                  if (markSettled) return;
                  setMarkAllPastSettled(!markAllPastSettled);
                }}
                activeOpacity={markSettled ? 1 : 0.7}
              >
                <FontAwesome name={markAllPastSettled ? "check-square" : "square-o"} size={20} color={markAllPastSettled ? ACCENT_GOLD : "#888"} />
                <Text style={[styles.checkboxLabel, { textAlign: isRTL ? 'right' : 'left' }, settings.compactMode && styles.textSmall]}>
                  {t('run.markAllPastSettled') || (isRTL ? 'تحديد هذا الطلب والطلبات السابقة كمسواة' : 'Mark this and all past orders as settled')}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {renderConfirmation()}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>{tCancel}</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.saveBtn, (parsedAmount <= 0) && styles.saveBtnDisabled]} 
              onPress={handleSave}
              disabled={parsedAmount <= 0}
            >
              <Text style={styles.saveText}>{tSave}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
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
    padding: 24,
    elevation: 10,
  },
  dialogCompact: {
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  titleCompact: {
    fontSize: 18,
  },
  closeBtn: {
    padding: 4,
  },
  label: {
    color: '#aaa',
    fontSize: 14,
    marginBottom: 8,
  },
  labelCompact: {
    fontSize: 12,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  currencySymbol: {
    color: '#888',
    fontSize: 20,
    marginRight: 8,
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 24,
    paddingVertical: 12,
  },
  inputCompact: {
    fontSize: 18,
    paddingVertical: 8,
  },
  confirmBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 200, 81, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0, 200, 81, 0.3)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    gap: 10,
    alignItems: 'flex-start',
  },
  confirmText: {
    color: '#ccc',
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  cancelText: {
    color: '#aaa',
    fontSize: 16,
    fontWeight: 'bold',
  },
  saveBtn: {
    backgroundColor: ACCENT_GOLD,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    flex: 1,
    alignItems: 'center',
    marginLeft: 10,
  },
  saveBtnDisabled: {
    backgroundColor: '#333',
  },
  saveText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  checkboxLabel: {
    color: '#ccc',
    fontSize: 16,
  },
  textSmall: {
    fontSize: 14,
  }
});
