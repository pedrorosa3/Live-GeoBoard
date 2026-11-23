// Endereço do servidor Node.js (API REST + WebSockets)
export const API_URL = 'http://localhost:3000';

export interface PointOwner {
  _id: string;
  username: string;
}

export interface GeoPoint {
  _id: string;
  lat: number;
  lng: number;
  title: string;
  category: string;
  owner: PointOwner | null;
}

export const CATEGORIES = [
  { value: 'blue', label: 'Azul' },
  { value: 'red', label: 'Vermelho' },
  { value: 'green', label: 'Verde' },
  { value: 'orange', label: 'Laranja' },
  { value: 'violet', label: 'Roxo' }
];
