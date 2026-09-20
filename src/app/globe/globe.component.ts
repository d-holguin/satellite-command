import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
  inject,
} from '@angular/core';
import { GlobeEngine } from './globe-engine';

@Component({
  selector: 'app-globe',
  standalone: true,
  templateUrl: './globe.component.html',
  styleUrl: './globe.component.scss',
})
export class GlobeComponent implements AfterViewInit, OnDestroy {
  @ViewChild('globeCanvas', { static: true })
  private readonly canvas!: ElementRef<HTMLCanvasElement>;

  private readonly ngZone = inject(NgZone);
  private engine?: GlobeEngine;

  ngAfterViewInit(): void {
    this.ngZone.runOutsideAngular(() => {
      this.engine = new GlobeEngine(this.canvas.nativeElement);
      this.engine.start();
    });
  }

  ngOnDestroy(): void {
    this.engine?.dispose();
    this.engine = undefined;
  }
}
