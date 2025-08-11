/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useReactToolScheduler,
  mapToDisplay,
} from './useReactToolScheduler.js';
import { PartUnion, FunctionResponse } from '@google/genai';
import {
  Config,
  ToolCallRequestInfo,
  ToolRegistry,
  ToolResult,
  ToolCallConfirmationDetails,
  ToolCallResponseInfo,
  ToolCall, // Import from core
  Status as ToolCallStatusType,
  ApprovalMode,
  Icon,
  BaseTool,
  AnyDeclarativeTool,
  AnyToolInvocation,
} from '@google/gemini-cli-core';
import { ToolCallStatus } from '../types.js';

// Mocks
vi.mock('@google/gemini-cli-core', async () => {
  const actual = await vi.importActual('@google/gemini-cli-core');
  return {
    ...actual,
    ToolRegistry: vi.fn(),
    Config: vi.fn(),
  };
});

const mockToolRegistry = {
  getTool: vi.fn(),
};

const mockConfig = {
  getToolRegistry: vi.fn(() => mockToolRegistry as unknown as ToolRegistry),
  getApprovalMode: vi.fn(() => ApprovalMode.DEFAULT),
  getUsageStatisticsEnabled: () => true,
  getDebugMode: () => false,
  getToolPermissions: vi.fn(() => ({
    alwaysAllow: [],
  })),
};

class MockTool extends BaseTool<object, ToolResult> {
  constructor(
    name: string,
    displayName: string,
    canUpdateOutput = false,
    shouldConfirm = false,
    isOutputMarkdown = false,
  ) {
    super(
      name,
      displayName,
      'A mock tool for testing',
      Icon.Hammer,
      {},
      isOutputMarkdown,
      canUpdateOutput,
    );
    if (shouldConfirm) {
      this.shouldConfirmExecute = vi.fn(
        async (): Promise<ToolCallConfirmationDetails | false> => ({
          type: 'edit',
          title: 'Mock Tool Requires Confirmation',
          onConfirm: mockOnUserConfirmForToolConfirmation,
          fileName: 'mockToolRequiresConfirmation.ts',
          fileDiff: 'Mock tool requires confirmation',
          originalContent: 'Original content',
          newContent: 'New content',
        }),
      );
    }
  }

  execute = vi.fn();
  shouldConfirmExecute = vi.fn();
}

let mockOnUserConfirmForToolConfirmation: Mock;
const mockToolRequiresConfirmation = new MockTool(
  'mockToolRequiresConfirmation',
  'Mock Tool Requires Confirmation',
  false,
  true,
);

describe('useReactToolScheduler in YOLO Mode', () => {
  let onComplete: Mock;
  let setPendingHistoryItem: Mock;

  beforeEach(() => {
    onComplete = vi.fn();
    setPendingHistoryItem = vi.fn();
    mockToolRegistry.getTool.mockClear();
    (mockToolRequiresConfirmation.execute as Mock).mockClear();
    (mockToolRequiresConfirmation.shouldConfirmExecute as Mock).mockClear();

    // IMPORTANT: Enable YOLO mode for this test suite
    (mockConfig.getApprovalMode as Mock).mockReturnValue(ApprovalMode.YOLO);

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    // IMPORTANT: Disable YOLO mode after this test suite
    (mockConfig.getApprovalMode as Mock).mockReturnValue(ApprovalMode.DEFAULT);
  });

  const renderSchedulerInYoloMode = () =>
    renderHook(() =>
      useReactToolScheduler(
        onComplete,
        mockConfig as unknown as Config,
        setPendingHistoryItem,
      ),
    );

  it('should skip confirmation and execute tool directly when yoloMode is true', async () => {
    mockToolRegistry.getTool.mockReturnValue(mockToolRequiresConfirmation);
    const expectedOutput = 'YOLO Confirmed output';
    (mockToolRequiresConfirmation.execute as Mock).mockResolvedValue({
      llmContent: expectedOutput,
      returnDisplay: 'YOLO Formatted tool output',
      summary: 'YOLO summary',
    } as ToolResult);

    const { result } = renderSchedulerInYoloMode();
    const schedule = result.current[1];
    const request: ToolCallRequestInfo = {
      callId: 'yoloCall',
      name: 'mockToolRequiresConfirmation',
      args: { data: 'any data' },
    };

    act(() => {
      schedule(request, new AbortController().signal);
    });

    await act(async () => {
      await vi.runAllTimersAsync(); // Process validation
    });
    await act(async () => {
      await vi.runAllTimersAsync(); // Process scheduling
    });
    await act(async () => {
      await vi.runAllTimersAsync(); // Process execution
    });

    // Check that shouldConfirmExecute was NOT called
    expect(
      mockToolRequiresConfirmation.shouldConfirmExecute,
    ).not.toHaveBeenCalled();

    // Check that execute WAS called
    expect(mockToolRequiresConfirmation.execute).toHaveBeenCalledWith(
      request.args,
      expect.any(AbortSignal),
      undefined,
    );

    // Check that onComplete was called with success
    expect(onComplete).toHaveBeenCalledWith([
      expect.objectContaining({
        status: 'success',
        request,
        response: expect.objectContaining({
          resultDisplay: 'YOLO Formatted tool output',
          responseParts: {
            functionResponse: {
              id: 'yoloCall',
              name: 'mockToolRequiresConfirmation',
              response: { output: expectedOutput },
            },
          },
        }),
      }),
    ]);
  });
});

describe('mapToDisplay', () => {
  const baseRequest: ToolCallRequestInfo = {
    callId: 'testCallId',
    name: 'testTool',
    args: { foo: 'bar' },
  };

  const baseTool = new MockTool('testTool', 'Test Tool Display');

  const baseResponse: ToolCallResponseInfo = {
    callId: 'testCallId',
    responseParts: [
      {
        functionResponse: {
          name: 'testTool',
          id: 'testCallId',
          response: { output: 'Test output' },
        } as FunctionResponse,
      } as PartUnion,
    ],
    resultDisplay: 'Test display output',
    summary: 'Test summary',
    error: undefined,
  };

  // Define a more specific type for extraProps for these tests
  // This helps ensure that tool and confirmationDetails are only accessed when they are expected to exist.
  type MapToDisplayExtraProps =
    | {
        tool?: AnyDeclarativeTool;
        invocation?: AnyToolInvocation;
        liveOutput?: string;
        response?: ToolCallResponseInfo;
        confirmationDetails?: ToolCallConfirmationDetails;
      }
    | {
        tool: AnyDeclarativeTool;
        invocation?: AnyToolInvocation;
        response?: ToolCallResponseInfo;
        confirmationDetails?: ToolCallConfirmationDetails;
      }
    | {
        response: ToolCallResponseInfo;
        tool?: undefined;
        confirmationDetails?: ToolCallConfirmationDetails;
      }
    | {
        confirmationDetails: ToolCallConfirmationDetails;
        tool?: AnyDeclarativeTool;
        invocation?: AnyToolInvocation;
        response?: ToolCallResponseInfo;
      };

  const baseInvocation = baseTool.build(baseRequest.args);
  const testCases: Array<{
    name: string;
    status: ToolCallStatusType;
    extraProps?: MapToDisplayExtraProps;
    expectedStatus: ToolCallStatus;
    expectedResultDisplay?: string;
    expectedName?: string;
    expectedDescription?: string;
  }> = [
    {
      name: 'validating',
      status: 'validating',
      extraProps: { tool: baseTool, invocation: baseInvocation },
      expectedStatus: ToolCallStatus.Executing,
      expectedName: baseTool.displayName,
      expectedDescription: baseTool.getDescription(baseRequest.args),
    },
    {
      name: 'awaiting_approval',
      status: 'awaiting_approval',
      extraProps: {
        tool: baseTool,
        invocation: baseInvocation,
        confirmationDetails: {
          onConfirm: vi.fn(),
          type: 'edit',
          title: 'Test Tool Display',
          serverName: 'testTool',
          toolName: 'testTool',
          toolDisplayName: 'Test Tool Display',
          fileName: 'test.ts',
          fileDiff: 'Test diff',
          originalContent: 'Original content',
          newContent: 'New content',
        } as ToolCallConfirmationDetails,
      },
      expectedStatus: ToolCallStatus.Confirming,
      expectedName: baseTool.displayName,
      expectedDescription: baseTool.getDescription(baseRequest.args),
    },
    {
      name: 'scheduled',
      status: 'scheduled',
      extraProps: { tool: baseTool, invocation: baseInvocation },
      expectedStatus: ToolCallStatus.Pending,
      expectedName: baseTool.displayName,
      expectedDescription: baseTool.getDescription(baseRequest.args),
    },
    {
      name: 'executing no live output',
      status: 'executing',
      extraProps: { tool: baseTool, invocation: baseInvocation },
      expectedStatus: ToolCallStatus.Executing,
      expectedName: baseTool.displayName,
      expectedDescription: baseTool.getDescription(baseRequest.args),
    },
    {
      name: 'executing with live output',
      status: 'executing',
      extraProps: {
        tool: baseTool,
        invocation: baseInvocation,
        liveOutput: 'Live test output',
      },
      expectedStatus: ToolCallStatus.Executing,
      expectedResultDisplay: 'Live test output',
      expectedName: baseTool.displayName,
      expectedDescription: baseTool.getDescription(baseRequest.args),
    },
    {
      name: 'success',
      status: 'success',
      extraProps: {
        tool: baseTool,
        invocation: baseInvocation,
        response: baseResponse,
      },
      expectedStatus: ToolCallStatus.Success,
      expectedResultDisplay: baseResponse.resultDisplay as any,
      expectedName: baseTool.displayName,
      expectedDescription: baseTool.getDescription(baseRequest.args),
    },
    {
      name: 'error tool not found',
      status: 'error',
      extraProps: {
        response: {
          ...baseResponse,
          error: new Error('Test error tool not found'),
          resultDisplay: 'Error display tool not found',
        },
      },
      expectedStatus: ToolCallStatus.Error,
      expectedResultDisplay: 'Error display tool not found',
      expectedName: baseRequest.name,
      expectedDescription: JSON.stringify(baseRequest.args),
    },
    {
      name: 'error tool execution failed',
      status: 'error',
      extraProps: {
        tool: baseTool,
        response: {
          ...baseResponse,
          error: new Error('Tool execution failed'),
          resultDisplay: 'Execution failed display',
        },
      },
      expectedStatus: ToolCallStatus.Error,
      expectedResultDisplay: 'Execution failed display',
      expectedName: baseTool.displayName, // Changed from baseTool.name
      expectedDescription: baseTool.getDescription(baseRequest.args),
    },
    {
      name: 'cancelled',
      status: 'cancelled',
      extraProps: {
        tool: baseTool,
        invocation: baseInvocation,
        response: {
          ...baseResponse,
          resultDisplay: 'Cancelled display',
        },
      },
      expectedStatus: ToolCallStatus.Canceled,
      expectedResultDisplay: 'Cancelled display',
      expectedName: baseTool.displayName,
      expectedDescription: baseTool.getDescription(baseRequest.args),
    },
  ];

  testCases.forEach(
    ({
      name: testName,
      status,
      extraProps,
      expectedStatus,
      expectedResultDisplay,
      expectedName,
      expectedDescription,
    }) => {
      it(`should map ToolCall with status '${status}' (${testName}) correctly`, () => {
        const toolCall: ToolCall = {
          request: baseRequest,
          status,
          ...(extraProps || {}),
        } as ToolCall;

        const display = mapToDisplay(toolCall);
        expect(display.type).toBe('tool_group');
        expect(display.tools.length).toBe(1);
        const toolDisplay = display.tools[0];

        expect(toolDisplay.callId).toBe(baseRequest.callId);
        expect(toolDisplay.status).toBe(expectedStatus);
        expect(toolDisplay.resultDisplay).toBe(expectedResultDisplay);

        expect(toolDisplay.name).toBe(expectedName);
        expect(toolDisplay.description).toBe(expectedDescription);

        expect(toolDisplay.renderOutputAsMarkdown).toBe(
          extraProps?.tool?.isOutputMarkdown ?? false,
        );
        if (status === 'awaiting_approval') {
          expect(toolDisplay.confirmationDetails).toBe(
            extraProps!.confirmationDetails,
          );
        } else {
          expect(toolDisplay.confirmationDetails).toBeUndefined();
        }
      });
    },
  );

  it('should map an array of ToolCalls correctly', () => {
    const toolCall1: ToolCall = {
      request: { ...baseRequest, callId: 'call1' },
      status: 'success',
      tool: baseTool,
      invocation: baseTool.build(baseRequest.args),
      response: { ...baseResponse, callId: 'call1' },
    } as ToolCall;
    const toolForCall2 = new MockTool(
      baseTool.name,
      baseTool.displayName,
      false,
      false,
      true,
    );
    const toolCall2: ToolCall = {
      request: { ...baseRequest, callId: 'call2' },
      status: 'executing',
      tool: toolForCall2,
      invocation: toolForCall2.build(baseRequest.args),
      liveOutput: 'markdown output',
    } as ToolCall;

    const display = mapToDisplay([toolCall1, toolCall2]);
    expect(display.tools.length).toBe(2);
    expect(display.tools[0].callId).toBe('call1');
    expect(display.tools[0].status).toBe(ToolCallStatus.Success);
    expect(display.tools[0].renderOutputAsMarkdown).toBe(false);
    expect(display.tools[1].callId).toBe('call2');
    expect(display.tools[1].status).toBe(ToolCallStatus.Executing);
    expect(display.tools[1].resultDisplay).toBe('markdown output');
    expect(display.tools[1].renderOutputAsMarkdown).toBe(true);
  });
});
