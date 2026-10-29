import { useLocalSearchParams } from 'expo-router';

import { ExerciseForm } from '@/features/exercises/exercise-form';

export default function EditExerciseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ExerciseForm exerciseId={id} />;
}
