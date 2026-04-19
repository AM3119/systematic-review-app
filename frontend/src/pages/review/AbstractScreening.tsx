import { useParams } from 'react-router-dom';
import ScreeningInterface from '../../components/screening/ScreeningInterface';

export default function AbstractScreening() {
  const { reviewId } = useParams<{ reviewId: string }>();
  return <ScreeningInterface reviewId={reviewId!} phase="abstract" />;
}
