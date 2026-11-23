import { AfterViewInit, Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import * as L from 'leaflet';
import { SocketService } from './services/socket';
import { AuthService } from './services/auth';
import { API_URL, CATEGORIES, GeoPoint } from './config';

type Editor =
  | { mode: 'create'; lat: number; lng: number }
  | { mode: 'edit'; id: string };

@Component({
  selector: 'app-root',
  standalone: true,
  template: `
    <header class="header">
      <div class="brand">
        <h1>🌍 Live GeoBoard</h1>
        <p>
          @if (user()) {
            Clica no mapa para adicionar um ponto. Abre os teus pontos para os editar ou remover.
          } @else {
            Inicia sessão para adicionar, editar e remover os teus pontos.
          }
        </p>
      </div>

      <div class="auth">
        @if (user(); as u) {
          <span>Sessão iniciada como <b>{{ u.username }}</b></span>
          <button type="button" class="secondary" (click)="logout()">Sair</button>
        } @else {
          <form class="auth-form" (submit)="$event.preventDefault(); submitAuth('login')">
            <input
              type="text"
              placeholder="Utilizador"
              autocomplete="username"
              [value]="username()"
              (input)="username.set(inputValue($event))"
            />
            <input
              type="password"
              placeholder="Password"
              autocomplete="current-password"
              [value]="password()"
              (input)="password.set(inputValue($event))"
            />
            <button type="submit" [disabled]="busy()">Entrar</button>
            <button type="button" class="secondary" [disabled]="busy()" (click)="submitAuth('register')">
              Criar conta
            </button>
          </form>
        }
      </div>
    </header>

    @if (message(); as msg) {
      <div class="message" [class.error]="msg.error" role="status">{{ msg.text }}</div>
    }

    <div class="map-wrapper">
      <div #map class="map"></div>

      @if (editor(); as ed) {
        <form class="editor" (submit)="$event.preventDefault(); saveEditor()">
          <h2>{{ ed.mode === 'create' ? 'Novo ponto' : 'Editar ponto' }}</h2>

          <label>
            Nome
            <input
              type="text"
              maxlength="100"
              required
              [value]="editorTitle()"
              (input)="editorTitle.set(inputValue($event))"
            />
          </label>

          <label>
            Cor
            <select [value]="editorCategory()" (change)="editorCategory.set(inputValue($event))">
              @for (cat of categories; track cat.value) {
                <option [value]="cat.value" [selected]="cat.value === editorCategory()">{{ cat.label }}</option>
              }
            </select>
          </label>

          <div class="editor-actions">
            <button type="button" class="secondary" (click)="closeEditor()">Cancelar</button>
            <button type="submit" [disabled]="busy() || !editorTitle().trim()">Guardar</button>
          </div>
        </form>
      }
    </div>
  `,
  styles: [`
    :host { display: block; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1f2328; }
    .header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; }
    .brand h1 { margin: 0; font-size: 1.5rem; }
    .brand p { margin: 4px 0 0; color: #59636e; }
    .auth { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .auth-form { display: flex; gap: 8px; flex-wrap: wrap; }
    input, select { padding: 7px 10px; border: 1px solid #d1d9e0; border-radius: 6px; font: inherit; }
    button { padding: 7px 14px; border: 1px solid #1f6feb; border-radius: 6px; background: #1f6feb; color: #fff; font: inherit; cursor: pointer; }
    button.secondary { background: #fff; color: #1f2328; border-color: #d1d9e0; }
    button:disabled { opacity: .6; cursor: default; }
    .message { margin: 0 16px 8px; padding: 8px 12px; border-radius: 6px; background: #ddf4ff; color: #0a3069; }
    .message.error { background: #ffebe9; color: #82071e; }
    .map-wrapper { position: relative; margin: 0 16px 16px; }
    .map { height: 78vh; width: 100%; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
    .editor { position: absolute; top: 12px; right: 12px; z-index: 1000; width: min(300px, calc(100% - 24px)); box-sizing: border-box;
              display: flex; flex-direction: column; gap: 10px; padding: 16px; background: #fff; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.2); }
    .editor h2 { margin: 0; font-size: 1.1rem; }
    .editor label { display: flex; flex-direction: column; gap: 4px; font-size: .9rem; }
    .editor-actions { display: flex; justify-content: flex-end; gap: 8px; }
  `]
})
export class App implements AfterViewInit {
  private socketService = inject(SocketService);
  private auth = inject(AuthService);
  private destroyRef = inject(DestroyRef);
  private mapElement = viewChild.required<ElementRef<HTMLElement>>('map');

  private map!: L.Map;
  private points = new Map<string, { point: GeoPoint; marker: L.Marker }>();
  private messageTimer?: ReturnType<typeof setTimeout>;

  readonly categories = CATEGORIES;
  readonly user = this.auth.user;

  readonly username = signal('');
  readonly password = signal('');
  readonly busy = signal(false);
  readonly message = signal<{ text: string; error: boolean } | null>(null);

  readonly editor = signal<Editor | null>(null);
  readonly editorTitle = signal('');
  readonly editorCategory = signal('blue');
  private editingId = computed(() => {
    const ed = this.editor();
    return ed?.mode === 'edit' ? ed.id : null;
  });

  ngAfterViewInit() {
    this.initMap();

    // 1. Carrega o histórico de pontos vindos do MongoDB (via HTTP)
    this.loadInitialPoints();

    // 2. Fica à escuta das alterações em tempo real (via Socket.io)
    this.socketService.onPointAdded()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((point) => this.upsertMarker(point));

    this.socketService.onPointUpdated()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((point) => this.upsertMarker(point));

    this.socketService.onPointRemoved()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ _id }) => this.removeMarker(_id));
  }

  inputValue(event: Event) {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  // --- Autenticação ---

  async submitAuth(mode: 'login' | 'register') {
    const username = this.username().trim();
    const password = this.password();
    if (!username || !password) {
      this.showMessage('Preenche o utilizador e a password.', true);
      return;
    }

    this.busy.set(true);
    try {
      if (mode === 'login') {
        await this.auth.login(username, password);
        this.showMessage(`Bem-vindo de volta, ${username}!`);
      } else {
        await this.auth.register(username, password);
        this.showMessage(`Conta criada. Bem-vindo, ${username}!`);
      }
      this.password.set('');
    } catch (error) {
      this.showMessage(this.errorText(error), true);
    } finally {
      this.busy.set(false);
    }
  }

  logout() {
    this.auth.logout();
    this.closeEditor();
    this.map.closePopup();
    this.showMessage('Sessão terminada.');
  }

  // --- Editor de pontos ---

  closeEditor() {
    this.editor.set(null);
  }

  async saveEditor() {
    const ed = this.editor();
    const title = this.editorTitle().trim();
    if (!ed || !title) return;

    const category = this.editorCategory();
    this.busy.set(true);
    try {
      if (ed.mode === 'create') {
        await this.socketService.createPoint({ lat: ed.lat, lng: ed.lng, title, category });
      } else {
        await this.socketService.updatePoint(ed.id, { title, category });
      }
      this.closeEditor();
    } catch (error) {
      this.showMessage(this.errorText(error), true);
    } finally {
      this.busy.set(false);
    }
  }

  private openEditor(editor: Editor, title = '', category = 'blue') {
    this.editorTitle.set(title);
    this.editorCategory.set(category);
    this.editor.set(editor);
  }

  private async deletePoint(point: GeoPoint) {
    if (!confirm(`Remover o ponto "${point.title}"?`)) return;
    try {
      await this.socketService.deletePoint(point._id);
    } catch (error) {
      this.showMessage(this.errorText(error), true);
    }
  }

  // --- Mapa ---

  private initMap(): void {
    this.map = L.map(this.mapElement().nativeElement).setView([39.3999, -8.2245], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    this.map.on('click', (e: L.LeafletMouseEvent) => {
      if (!this.user()) {
        this.showMessage('Inicia sessão para adicionar pontos.', true);
        return;
      }
      this.openEditor({ mode: 'create', lat: e.latlng.lat, lng: e.latlng.lng });
    });
  }

  private async loadInitialPoints() {
    try {
      const response = await fetch(`${API_URL}/api/points`);
      const points: GeoPoint[] = await response.json();
      points.forEach((point) => this.upsertMarker(point));
    } catch (error) {
      console.error('Erro ao carregar o histórico de pontos:', error);
      this.showMessage('Não foi possível carregar os pontos do servidor.', true);
    }
  }

  private createIcon(category: string) {
    const color = CATEGORIES.some((c) => c.value === category) ? category : 'blue';
    return L.divIcon({
      className: `pin pin-${color}`,
      html: '<span></span>',
      iconSize: [26, 26],
      iconAnchor: [13, 26],
      popupAnchor: [0, -24]
    });
  }

  private upsertMarker(point: GeoPoint) {
    const existing = this.points.get(point._id);
    if (existing) {
      existing.point = point;
      existing.marker.setLatLng([point.lat, point.lng]).setIcon(this.createIcon(point.category));
      if (existing.marker.isPopupOpen()) {
        existing.marker.setPopupContent(this.buildPopup(point._id));
      }
      return;
    }

    const marker = L.marker([point.lat, point.lng], { icon: this.createIcon(point.category) })
      .addTo(this.map)
      // O conteúdo é gerado sempre que o popup abre, para refletir o utilizador atual
      .bindPopup(() => this.buildPopup(point._id));

    this.points.set(point._id, { point, marker });
  }

  private removeMarker(id: string) {
    const entry = this.points.get(id);
    if (!entry) return;
    entry.marker.remove();
    this.points.delete(id);
    if (this.editingId() === id) {
      this.closeEditor();
      this.showMessage('Este ponto foi removido.', true);
    }
  }

  // Constrói o popup com elementos DOM (textContent) para não injetar HTML vindo de utilizadores
  private buildPopup(id: string): HTMLElement {
    const container = document.createElement('div');
    container.className = 'point-popup';
    const point = this.points.get(id)?.point;
    if (!point) return container;

    const title = document.createElement('b');
    title.textContent = point.title;

    const author = document.createElement('small');
    author.textContent = point.owner ? `Criado por ${point.owner.username}` : 'Autor desconhecido';

    container.append(title, author);

    const user = this.user();
    if (user && point.owner?._id === user._id) {
      const actions = document.createElement('div');
      actions.className = 'point-popup-actions';

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Editar';
      edit.onclick = () => {
        this.map.closePopup();
        this.openEditor({ mode: 'edit', id: point._id }, point.title, point.category);
      };

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'danger';
      remove.textContent = 'Remover';
      remove.onclick = () => {
        this.map.closePopup();
        this.deletePoint(point);
      };

      actions.append(edit, remove);
      container.append(actions);
    }

    return container;
  }

  private showMessage(text: string, error = false) {
    clearTimeout(this.messageTimer);
    this.message.set({ text, error });
    this.messageTimer = setTimeout(() => this.message.set(null), 4000);
  }

  private errorText(error: unknown) {
    return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.';
  }
}
