import { Component } from '@angular/core';
import { GlobeComponent } from './globe/globe.component';
import { HudComponent } from './hud/hud.component';

@Component({
  imports: [GlobeComponent, HudComponent],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {}
