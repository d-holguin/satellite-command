import { createPropagationRequest, createTrajectoryRequest } from './orbit-worker-client';

describe('orbit worker timestamp requests', () => {
  it('uses the supplied simulation clock for bulk propagation', () => {
    const simulationTime = new Date('2042-03-04T05:06:07.890Z');
    const request = createPropagationRequest(() => simulationTime);

    expect(request.timestampMs).toBe(simulationTime.getTime());
  });

  it('uses the same simulation clock for selected trajectories', () => {
    const simulationTime = new Date('2042-03-04T05:06:07.890Z');
    const request = createTrajectoryRequest(53, () => simulationTime);

    expect(request).toMatchObject({
      type: 'trajectory',
      index: 53,
      timestampMs: simulationTime.getTime(),
    });
  });
});
