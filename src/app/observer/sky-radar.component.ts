import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ObserverLocationService } from '../core/observer-location.service';
import { SatelliteStateService } from '../core/satellite-state.service';
import { skyRadarPosition } from '../orbital/observer-geometry';
import { matchesSatelliteFilter } from '../orbital/satellite-catalog';

@Component({
  selector: 'app-sky-radar',
  standalone: true,
  templateUrl: './sky-radar.component.html',
  styleUrl: './sky-radar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkyRadarComponent implements AfterViewInit, OnDestroy {
  @ViewChild('radarCanvas', { static: true })
  private readonly canvas!: ElementRef<HTMLCanvasElement>;

  private readonly observer = inject(ObserverLocationService);
  private readonly satelliteState = inject(SatelliteStateService);
  private readonly ready = signal(false);
  private readonly resizeObserver = new ResizeObserver(() => this.scheduleDraw());
  private animationFrameId: number | null = null;

  protected readonly points = computed(() => {
    const catalog = this.satelliteState.catalog()?.satellites ?? [];
    const filter = this.satelliteState.filter();
    const selectedIndex = this.satelliteState.selectedIndex();
    return this.observer.aboveSatellites().flatMap((look) => {
      const satellite = catalog[look.index];
      if (!satellite || !matchesSatelliteFilter(satellite, filter)) return [];
      const position = skyRadarPosition(look.azimuthDeg, look.elevationDeg);
      return [
        {
          ...look,
          ...position,
          name: satellite.name,
          selected: look.index === selectedIndex,
          iss: satellite.noradId === 25544,
        },
      ];
    });
  });

  private readonly drawEffect = effect(() => {
    this.ready();
    this.points();
    this.scheduleDraw();
  });

  ngAfterViewInit(): void {
    this.ready.set(true);
    this.resizeObserver.observe(this.canvas.nativeElement);
  }

  ngOnDestroy(): void {
    this.resizeObserver.disconnect();
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
  }

  protected selectNearest(event: MouseEvent): void {
    const canvas = this.canvas.nativeElement;
    const bounds = canvas.getBoundingClientRect();
    const centerX = bounds.width / 2;
    const centerY = bounds.height / 2;
    const radius = Math.min(bounds.width, bounds.height) * 0.42;
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    let closestIndex: number | null = null;
    let closestDistance = 10;

    for (const point of this.points()) {
      const distance = Math.hypot(
        pointerX - (centerX + point.x * radius),
        pointerY - (centerY + point.y * radius),
      );
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = point.index;
      }
    }
    if (closestIndex !== null) this.satelliteState.select(closestIndex);
  }

  private scheduleDraw(): void {
    if (!this.ready() || this.animationFrameId !== null) return;
    this.animationFrameId = requestAnimationFrame(() => {
      this.animationFrameId = null;
      this.draw();
    });
  }

  private draw(): void {
    const canvas = this.canvas.nativeElement;
    const width = Math.max(canvas.clientWidth, 1);
    const height = Math.max(canvas.clientHeight, 1);
    const pixelRatio = Math.min(devicePixelRatio, 2);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(pixelRatio, pixelRatio);
    context.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.42;
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(151, 194, 214, 0.2)';
    for (const fraction of [1, 2 / 3, 1 / 3]) {
      context.beginPath();
      context.arc(centerX, centerY, radius * fraction, 0, Math.PI * 2);
      context.stroke();
    }
    context.strokeStyle = 'rgba(151, 194, 214, 0.08)';
    context.beginPath();
    context.moveTo(centerX - radius, centerY);
    context.lineTo(centerX + radius, centerY);
    context.moveTo(centerX, centerY - radius);
    context.lineTo(centerX, centerY + radius);
    context.stroke();

    context.fillStyle = 'rgba(190, 215, 226, 0.62)';
    context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('N', centerX, centerY - radius - 12);
    context.fillText('E', centerX + radius + 12, centerY);
    context.fillText('S', centerX, centerY + radius + 12);
    context.fillText('W', centerX - radius - 12, centerY);
    context.fillStyle = 'rgba(190, 215, 226, 0.38)';
    context.font = '8px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.textAlign = 'left';
    context.fillText('30°', centerX + 4, centerY - radius * (2 / 3));
    context.fillText('60°', centerX + 4, centerY - radius / 3);
    context.fillText('90°', centerX + 4, centerY);

    for (const point of this.points()) {
      const x = centerX + point.x * radius;
      const y = centerY + point.y * radius;
      const pointRadius = point.selected ? 4.5 : point.iss ? 3.2 : 1.8;
      context.beginPath();
      context.arc(x, y, pointRadius, 0, Math.PI * 2);
      context.fillStyle = point.selected
        ? '#fff1c9'
        : point.iss
          ? '#8bdcf0'
          : 'rgba(190, 218, 230, 0.72)';
      context.fill();
    }
  }
}
