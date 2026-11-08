// Configurable oscilloscope sample capture engine.
//
// The module intentionally has no ADC or ESP32-specific logic.  The ADC
// interface supplies one sample whenever sample_valid is asserted.  A later
// SPI/register block can drive the configuration and read interface.
//
// Capture definition:
//   - pretrigger_count samples are retained before the trigger sample.
//   - posttrigger_count includes the trigger sample itself.
//   - Therefore, total capture length = pretrigger_count + posttrigger_count.
//   - The configured length must be <= 2**ADDR_WIDTH.

module osc_capture #(
    parameter int SAMPLE_WIDTH = 12,
    parameter int ADDR_WIDTH   = 12
) (
    input  logic                    clk,
    input  logic                    rst,

    // Sample source. Samples are accepted only when sample_valid is high.
    input  logic [SAMPLE_WIDTH-1:0] sample_data,
    input  logic                    sample_valid,

    // Configuration/control. arm is expected to be a one-clock pulse.
    input  logic                    arm,
    input  logic                    abort,
    input  logic                    trigger_enable,
    input  logic                    trigger_rising,
    input  logic [SAMPLE_WIDTH-1:0] trigger_level,
    input  logic [ADDR_WIDTH:0]      pretrigger_count,
    input  logic [ADDR_WIDTH:0]      posttrigger_count,

    // Status.
    output logic                    busy,
    output logic                    triggered,
    output logic                    done,
    output logic [ADDR_WIDTH:0]      capture_length,

    // Relative read interface. Address zero is the oldest sample in the
    // completed capture. This is intentionally simple for the first version;
    // the future SPI block can sequence these reads.
    input  logic [ADDR_WIDTH:0]      read_index,
    output logic [SAMPLE_WIDTH-1:0] read_data,
    output logic                    read_valid
);

    localparam int DEPTH = 1 << ADDR_WIDTH;

    logic [SAMPLE_WIDTH-1:0] sample_mem [0:DEPTH-1];
    logic [ADDR_WIDTH-1:0] write_ptr;
    logic [ADDR_WIDTH-1:0] capture_start;
    logic [ADDR_WIDTH:0]   post_remaining;
    logic [ADDR_WIDTH:0]   capture_length_latched;
    logic [ADDR_WIDTH:0]   posttrigger_count_latched;
    logic                    trigger_enable_latched;
    logic                    trigger_rising_latched;
    logic [SAMPLE_WIDTH-1:0] trigger_level_latched;
    logic [SAMPLE_WIDTH-1:0] previous_sample;
    logic                    previous_valid;

    wire [ADDR_WIDTH:0] requested_length = pretrigger_count + posttrigger_count;
    wire [ADDR_WIDTH-1:0] next_write_ptr = write_ptr + 1'b1;
    wire [ADDR_WIDTH-1:0] start_from_next =
        next_write_ptr - capture_length_latched[ADDR_WIDTH-1:0];

    wire rising_crossing = previous_valid &&
                           (previous_sample < trigger_level_latched) &&
                           (sample_data >= trigger_level_latched);
    wire falling_crossing = previous_valid &&
                            (previous_sample > trigger_level_latched) &&
                            (sample_data <= trigger_level_latched);
    wire trigger_event = !trigger_enable_latched ||
                         (trigger_rising_latched ? rising_crossing : falling_crossing);

    always_ff @(posedge clk) begin
        if (rst) begin
            busy                  <= 1'b0;
            triggered             <= 1'b0;
            done                  <= 1'b0;
            capture_length        <= '0;
            capture_length_latched <= '0;
            posttrigger_count_latched <= '0;
            trigger_enable_latched <= 1'b0;
            trigger_rising_latched <= 1'b1;
            trigger_level_latched <= '0;
            write_ptr             <= '0;
            capture_start         <= '0;
            post_remaining        <= '0;
            previous_sample       <= '0;
            previous_valid        <= 1'b0;
        end else begin
            if (arm) begin
                busy                   <= 1'b1;
                triggered              <= 1'b0;
                done                   <= 1'b0;
                write_ptr              <= '0;
                capture_start          <= '0;
                previous_valid         <= 1'b0;
                capture_length_latched <= requested_length;
                capture_length         <= requested_length;
                posttrigger_count_latched <= posttrigger_count;
                trigger_enable_latched <= trigger_enable;
                trigger_rising_latched <= trigger_rising;
                trigger_level_latched <= trigger_level;
                post_remaining         <= '0;
            end else if (abort) begin
                busy           <= 1'b0;
                triggered      <= 1'b0;
                post_remaining <= '0;
            end else if (busy && sample_valid) begin
                sample_mem[write_ptr] <= sample_data;
                write_ptr             <= next_write_ptr;
                previous_sample       <= sample_data;
                previous_valid        <= 1'b1;

                if (!triggered) begin
                    if (trigger_event) begin
                        triggered      <= 1'b1;

                        // The trigger sample is the first post-trigger
                        // sample. A post count of one completes immediately.
                        if (posttrigger_count_latched <= 1) begin
                            busy          <= 1'b0;
                            done          <= 1'b1;
                            capture_start <= start_from_next;
                        end else begin
                            post_remaining <= posttrigger_count_latched - 1'b1;
                        end
                    end
                end else if (post_remaining <= 1) begin
                    busy          <= 1'b0;
                    done          <= 1'b1;
                    capture_start <= start_from_next;
                    post_remaining <= '0;
                end else begin
                    post_remaining <= post_remaining - 1'b1;
                end
            end
        end
    end

    // The buffer is inferred as a simple asynchronous-read memory in this
    // first implementation. It can be changed to a synchronous read port
    // when the SPI throughput requirements are known.
    always_comb begin
        read_valid = done && (read_index < capture_length_latched);
        read_data  = '0;
        if (read_valid) begin
            read_data = sample_mem[capture_start + read_index[ADDR_WIDTH-1:0]];
        end
    end

endmodule
