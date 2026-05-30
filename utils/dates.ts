export function getLocalDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function generateDateOptions(t: (key: string) => string, daysShort: string, days: number = 14) {
  const options: string[] = [];
  const today = new Date();
  const weekdays = daysShort.split(',');
  
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    
    const value = getLocalDateString(d);
    const weekday = weekdays[d.getDay()];
    let label = `${value} (${weekday})`;
    
    if (i === 0) label = `${t('common.today')} - ${label}`;
    if (i === 1) label = `${t('common.tomorrow')} - ${label}`;
    
    options.push(label);
  }
  
  return options;
}

export function extractDateValue(selection: string) {
  const match = selection.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : selection;
}

export function getDefaultDate() {
  const now = new Date();
  const hour = now.getHours();
  const target = new Date(now);
  // Default to tomorrow if current time is between 4pm (16:00) and 11:59pm
  if (hour >= 16) {
    target.setDate(now.getDate() + 1);
  }
  return target;
}

export function formatDateLabel(date: Date, t: (key: string) => string, daysShort: string) {
  const value = getLocalDateString(date);
  const weekdays = daysShort.split(',');
  const weekday = weekdays[date.getDay()];
  
  const today = new Date();
  const todayStr = getLocalDateString(today);
  
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const tomorrowStr = getLocalDateString(tomorrow);
  
  let label = `\u2066${value} (${weekday})\u2069`;
  if (value === todayStr) label = `${t('common.today')} - ${label}`;
  else if (value === tomorrowStr) label = `${t('common.tomorrow')} - ${label}`;
  
  return label;
}

export function formatDateTime(dateStr: string | null | undefined, lang: 'en' | 'ar') {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  
  try {
    return date.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch (e) {
    return date.toLocaleString();
  }
}
