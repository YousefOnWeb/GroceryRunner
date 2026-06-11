import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  } as any),
});

export const requestNotificationPermissions = async () => {
  if (Platform.OS === 'web') return false;
  
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  
  return finalStatus === 'granted';
};

export const scheduleTaskNotification = async (
  taskId: string,
  title: string,
  targetDate: string | null,
  targetTime: string | null
): Promise<string | null> => {
  if (Platform.OS === 'web') return null;
  if (!targetTime) return null; // No time = no notification

  const hasPermission = await requestNotificationPermissions();
  if (!hasPermission) return null;

  try {
    const [hours, minutes] = targetTime.split(':').map(Number);
    let trigger: Notifications.NotificationTriggerInput;

    if (targetDate) {
      // One-off notification for a specific date
      const [year, month, day] = targetDate.split('-').map(Number);
      const triggerDate = new Date(year, month - 1, day, hours, minutes);
      
      // Don't schedule if in the past
      if (triggerDate.getTime() < Date.now()) return null;
      
      trigger = {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
      };
    } else {
      // Daily recurring notification
      trigger = {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: hours,
        minute: minutes,
      };
    }

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Task Reminder 📋',
        body: title,
        data: { taskId },
        sound: true,
      },
      trigger,
    });

    return notificationId;
  } catch (error) {
    console.error('Error scheduling notification:', error);
    return null;
  }
};

export const cancelTaskNotification = async (notificationId: string | null) => {
  if (Platform.OS === 'web' || !notificationId) return;
  
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch (error) {
    console.error('Error cancelling notification:', error);
  }
};
