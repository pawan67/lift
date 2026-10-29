/**
 * Asks for a date, then a time, with Android's system pickers.
 *
 * On Android the pickers are dialogs the platform owns and opens on request, so
 * two calls in a row are the whole control. iOS lays the same library out as a
 * view instead, which is `StartTimeSheet`. The web build has neither, and the
 * save screen's start row stays read-only there.
 */

import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

function ask(mode: 'date' | 'time', value: Date, maximumDate?: Date): Promise<Date | null> {
  return new Promise((resolve) => {
    DateTimePickerAndroid.open({
      value,
      mode,
      is24Hour: true,
      maximumDate,
      onChange: (event, picked) => resolve(event.type === 'set' && picked ? picked : null),
    });
  });
}

/**
 * The chosen moment, or null if either dialog was dismissed. Never later than
 * `latest`: a session cannot have started in the future.
 */
export async function pickDateTime(initial: Date, latest: Date): Promise<Date | null> {
  const day = await ask('date', initial, latest);
  if (!day) return null;

  // The time dialog opens on the original time of day, on the day just chosen.
  const seeded = new Date(day);
  seeded.setHours(initial.getHours(), initial.getMinutes(), 0, 0);

  const time = await ask('time', seeded);
  if (!time) return null;

  const result = new Date(day);
  result.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return result.getTime() > latest.getTime() ? latest : result;
}
