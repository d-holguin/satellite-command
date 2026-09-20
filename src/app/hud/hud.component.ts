import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SimulationTimeService } from '../core/simulation-time.service';

@Component({
  selector: 'app-hud',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './hud.component.html',
  styleUrl: './hud.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HudComponent {
  private readonly simulationTime = inject(SimulationTimeService);

  protected readonly currentTime = this.simulationTime.currentTime;
}
