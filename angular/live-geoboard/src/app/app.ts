import { Component, OnInit } from '@angular/core';
import * as L from 'leaflet';
import { SocketService } from './services/socket';

@Component({
  selector: 'app-root',
  standalone: true,
  template: `
    <div class="header">
      <h1>🌍 Live GeoBoard</h1>
      <p>Clica no mapa para adicionar um ponto. Ele vai aparecer em tempo real para todos os utilizadores!</p>
    </div>
    <div id="map"></div>
  `,
  styles: [`
    .header { text-align: center; padding: 10px; font-family: sans-serif; }
    #map { height: 80vh; width: 100%; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
  `]
})
export class App implements OnInit {
  private map!: L.Map;

  private defaultIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
    iconAnchor: [12, 41]
  });

  constructor(private socketService: SocketService) {}

  ngOnInit() {
    this.initMap();

    // 1. Carrega o histórico de pontos vindos do MongoDB (via HTTP)
    this.loadInitialPoints();

    // 2. Fica à escuta de novos pontos em tempo real (via Socket.io)
    this.socketService.onNewPoint().subscribe((point: any) => {
      this.addMarkerToMap(point);
    });
  }

  private initMap(): void {
    this.map = L.map('map').setView([39.3999, -8.2245], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    this.map.on('click', (e: L.LeafletMouseEvent) => {
      const title = prompt('Dá um nome a este ponto:');
      
      if (title) {
        const newPoint = {
          lat: e.latlng.lat,
          lng: e.latlng.lng,
          title: title,
          category: 'blue'
        };
        
        this.socketService.sendPoint(newPoint);
      }
    });
  }

  // --- NOVA FUNÇÃO HTTP ---
  private async loadInitialPoints() {
    try {
      const response = await fetch('http://localhost:3000/api/points');
      const points = await response.json();
      
      // Desenha cada ponto guardado no mapa
      points.forEach((point: any) => {
        this.addMarkerToMap(point);
      });
    } catch (error) {
      console.error('Erro ao carregar o histórico de pontos:', error);
    }
  }

  private addMarkerToMap(point: any) {
    L.marker([point.lat, point.lng], { icon: this.defaultIcon })
      .addTo(this.map)
      .bindPopup(`<b>${point.title}</b><br>Adicionado ao vivo!`)
      .openPopup();
  }
}