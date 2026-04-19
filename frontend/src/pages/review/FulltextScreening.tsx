import { useParams } from 'react-router-dom';
import ScreeningInterface from '../../components/screening/ScreeningInterface';

export default function FulltextScreening() {
  const { reviewId } = useParams<{ reviewId: string }>();
  return <ScreeningInterface reviewId={reviewId!} phase="fulltext" />;
}
