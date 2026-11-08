// 12-bit source-synchronous waveform transmitter.
//
// The transmitter assumes sample_rd_data is an asynchronous read of the
// capture buffer. sample_rd_addr changes on the falling edge of bus_clk, so
// the next sample is stable before the following rising edge, where the ESP32
// DMA receiver samples DATA.
//
// start, sample_count, and data_ready are currently expected to be in the
// bus_clk domain. Clock-domain synchronizers will be added at the integration
// level when the SPI/system-clock wrapper is created.

module parallel_sample_tx #(
    parameter int SAMPLE_WIDTH = 12,
    parameter int ADDR_WIDTH   = 12
) (
    input  logic                    rst,
    input  logic                    bus_clk,

    // Begin sending one completed capture. start should be a pulse.
    input  logic                    start,
    input  logic [ADDR_WIDTH:0]     sample_count,
    input  logic                    data_ready,

    // Capture-buffer read interface.
    output logic [ADDR_WIDTH-1:0]   sample_rd_addr,
    input  logic [SAMPLE_WIDTH-1:0] sample_rd_data,

    // FPGA-to-ESP32 parallel bus.
    output logic [SAMPLE_WIDTH-1:0] data,
    output logic                    data_clk,
    output logic                    data_valid,

    output logic                    busy,
    output logic                    done
);

    logic [ADDR_WIDTH:0] sample_index;
    logic [ADDR_WIDTH:0] sample_count_latched;
    logic                pending;

    // DATA is combinationally connected to the currently selected capture
    // sample. The address is updated on bus-clock falling edges, providing a
    // half-cycle for the memory output to settle before the next rising edge.
    always_comb begin
        data       = '0;
        data_clk   = 1'b0;
        data_valid = 1'b0;

        if (busy) begin
            data       = sample_rd_data;
            data_clk   = bus_clk;
            data_valid = 1'b1;
        end
    end

    always_ff @(negedge bus_clk or posedge rst) begin
        if (rst) begin
            sample_rd_addr      <= '0;
            sample_index        <= '0;
            sample_count_latched <= '0;
            pending             <= 1'b0;
            busy                <= 1'b0;
            done                <= 1'b0;
        end else begin
            done <= 1'b0;

            if (!busy) begin
                if (start && (sample_count != 0)) begin
                    sample_count_latched <= sample_count;
                    pending              <= 1'b1;
                    sample_index         <= '0;
                    sample_rd_addr      <= '0;
                end

                // Do not begin toggling DATA_CLK until the ESP32 has
                // prepared its DMA receiver.
                if (pending && data_ready) begin
                    pending        <= 1'b0;
                    busy           <= 1'b1;
                    sample_index   <= '0;
                    sample_rd_addr <= '0;
                end
            end else begin
                // The current sample was presented during the preceding
                // rising edge. Advance to the next sample for the next edge.
                if (sample_index == sample_count_latched - 1'b1) begin
                    busy <= 1'b0;
                    done <= 1'b1;
                end else begin
                    sample_index   <= sample_index + 1'b1;
                    sample_rd_addr <= sample_rd_addr + 1'b1;
                end
            end
        end
    end

endmodule
