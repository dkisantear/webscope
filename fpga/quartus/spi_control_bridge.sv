// Clock-domain bridge between the SPI configuration slave and the main FPGA
// system clock domain.
//
// SPI configuration registers are written first, then ARM/ABORT/CLEAR is
// written as a toggle command. By the time the synchronized toggle reaches
// the system clock domain, the configuration buses have been stable for
// multiple cycles and can be sampled safely from their synchronized copies.

module spi_control_bridge #(
    parameter int ADC_WIDTH = 12,
    parameter int COUNT_WIDTH = 32
) (
    input  logic                     rst,

    // Main system/capture clock.
    input  logic                     clk,

    // Physical SPI pins. The FPGA is the SPI peripheral.
    input  logic                     spi_sclk,
    input  logic                     spi_cs_n,
    input  logic                     spi_mosi,
    output logic                     spi_miso,

    // Configuration outputs in the main system clock domain.
    output logic [ADC_WIDTH-1:0]     trigger_level,
    output logic                     trigger_enable,
    output logic                     trigger_rising,
    output logic [COUNT_WIDTH-1:0]   pretrigger_count,
    output logic [COUNT_WIDTH-1:0]   posttrigger_count,
    output logic [COUNT_WIDTH-1:0]   sample_rate,
    output logic                     arm_pulse,
    output logic                     abort_pulse,
    output logic                     clear_pulse,

    // Main system status returned to the ESP32 through SPI.
    input  logic                     status_busy,
    input  logic                     status_triggered,
    input  logic                     status_done,
    input  logic [COUNT_WIDTH-1:0]   status_capture_length
);

    logic [ADC_WIDTH-1:0]   trigger_level_spi;
    logic                   trigger_enable_spi;
    logic                   trigger_rising_spi;
    logic [COUNT_WIDTH-1:0] pretrigger_count_spi;
    logic [COUNT_WIDTH-1:0] posttrigger_count_spi;
    logic [COUNT_WIDTH-1:0] sample_rate_spi;
    logic                   arm_toggle_spi;
    logic                   abort_toggle_spi;
    logic                   clear_toggle_spi;

    logic                   status_busy_spi_1;
    logic                   status_busy_spi_2;
    logic                   status_triggered_spi_1;
    logic                   status_triggered_spi_2;
    logic                   status_done_spi_1;
    logic                   status_done_spi_2;
    logic [COUNT_WIDTH-1:0] status_capture_length_spi_1;
    logic [COUNT_WIDTH-1:0] status_capture_length_spi_2;

    logic                   arm_toggle_clk_1;
    logic                   arm_toggle_clk_2;
    logic                   abort_toggle_clk_1;
    logic                   abort_toggle_clk_2;
    logic                   clear_toggle_clk_1;
    logic                   clear_toggle_clk_2;
    logic                   arm_toggle_seen;
    logic                   abort_toggle_seen;
    logic                   clear_toggle_seen;

    logic [ADC_WIDTH-1:0]   trigger_level_clk_1;
    logic [ADC_WIDTH-1:0]   trigger_level_clk_2;
    logic                   trigger_enable_clk_1;
    logic                   trigger_enable_clk_2;
    logic                   trigger_rising_clk_1;
    logic                   trigger_rising_clk_2;
    logic [COUNT_WIDTH-1:0] pretrigger_count_clk_1;
    logic [COUNT_WIDTH-1:0] pretrigger_count_clk_2;
    logic [COUNT_WIDTH-1:0] posttrigger_count_clk_1;
    logic [COUNT_WIDTH-1:0] posttrigger_count_clk_2;
    logic [COUNT_WIDTH-1:0] sample_rate_clk_1;
    logic [COUNT_WIDTH-1:0] sample_rate_clk_2;

    spi_config_slave spi_slave (
        .rst                       (rst),
        .spi_sclk                  (spi_sclk),
        .spi_cs_n                  (spi_cs_n),
        .spi_mosi                  (spi_mosi),
        .spi_miso                  (spi_miso),
        .cfg_trigger_level         (trigger_level_spi),
        .cfg_trigger_enable        (trigger_enable_spi),
        .cfg_trigger_rising        (trigger_rising_spi),
        .cfg_pretrigger_count      (pretrigger_count_spi),
        .cfg_posttrigger_count     (posttrigger_count_spi),
        .cfg_sample_rate           (sample_rate_spi),
        .cfg_arm_toggle            (arm_toggle_spi),
        .cfg_abort_toggle          (abort_toggle_spi),
        .cfg_clear_toggle          (clear_toggle_spi),
        .status_busy               (status_busy_spi_2),
        .status_triggered          (status_triggered_spi_2),
        .status_done               (status_done_spi_2),
        .status_capture_length    (status_capture_length_spi_2)
    );

    // Synchronize status into the SPI clock domain.
    always_ff @(posedge spi_sclk or posedge rst) begin
        if (rst) begin
            status_busy_spi_1          <= 1'b0;
            status_busy_spi_2          <= 1'b0;
            status_triggered_spi_1    <= 1'b0;
            status_triggered_spi_2    <= 1'b0;
            status_done_spi_1          <= 1'b0;
            status_done_spi_2          <= 1'b0;
            status_capture_length_spi_1 <= '0;
            status_capture_length_spi_2 <= '0;
        end else begin
            status_busy_spi_1           <= status_busy;
            status_busy_spi_2           <= status_busy_spi_1;
            status_triggered_spi_1     <= status_triggered;
            status_triggered_spi_2     <= status_triggered_spi_1;
            status_done_spi_1           <= status_done;
            status_done_spi_2           <= status_done_spi_1;
            status_capture_length_spi_1 <= status_capture_length;
            status_capture_length_spi_2 <= status_capture_length_spi_1;
        end
    end

    // Synchronize commands and configuration into the system clock domain.
    always_ff @(posedge clk or posedge rst) begin
        if (rst) begin
            arm_toggle_clk_1       <= 1'b0;
            arm_toggle_clk_2       <= 1'b0;
            abort_toggle_clk_1     <= 1'b0;
            abort_toggle_clk_2     <= 1'b0;
            clear_toggle_clk_1     <= 1'b0;
            clear_toggle_clk_2     <= 1'b0;
            arm_toggle_seen        <= 1'b0;
            abort_toggle_seen      <= 1'b0;
            clear_toggle_seen      <= 1'b0;

            trigger_level_clk_1   <= '0;
            trigger_level_clk_2   <= '0;
            trigger_enable_clk_1  <= 1'b0;
            trigger_enable_clk_2  <= 1'b0;
            trigger_rising_clk_1  <= 1'b1;
            trigger_rising_clk_2  <= 1'b1;
            pretrigger_count_clk_1  <= '0;
            pretrigger_count_clk_2  <= '0;
            posttrigger_count_clk_1 <= '0;
            posttrigger_count_clk_2 <= '0;
            sample_rate_clk_1       <= '0;
            sample_rate_clk_2       <= '0;

            trigger_level          <= '0;
            trigger_enable         <= 1'b0;
            trigger_rising         <= 1'b1;
            pretrigger_count      <= '0;
            posttrigger_count     <= '0;
            sample_rate           <= '0;
            arm_pulse             <= 1'b0;
            abort_pulse           <= 1'b0;
            clear_pulse           <= 1'b0;
        end else begin
            arm_toggle_clk_1       <= arm_toggle_spi;
            arm_toggle_clk_2       <= arm_toggle_clk_1;
            abort_toggle_clk_1     <= abort_toggle_spi;
            abort_toggle_clk_2     <= abort_toggle_clk_1;
            clear_toggle_clk_1     <= clear_toggle_spi;
            clear_toggle_clk_2     <= clear_toggle_clk_1;

            trigger_level_clk_1   <= trigger_level_spi;
            trigger_level_clk_2   <= trigger_level_clk_1;
            trigger_enable_clk_1  <= trigger_enable_spi;
            trigger_enable_clk_2  <= trigger_enable_clk_1;
            trigger_rising_clk_1  <= trigger_rising_spi;
            trigger_rising_clk_2  <= trigger_rising_clk_1;
            pretrigger_count_clk_1  <= pretrigger_count_spi;
            pretrigger_count_clk_2  <= pretrigger_count_clk_1;
            posttrigger_count_clk_1 <= posttrigger_count_spi;
            posttrigger_count_clk_2 <= posttrigger_count_clk_1;
            sample_rate_clk_1       <= sample_rate_spi;
            sample_rate_clk_2       <= sample_rate_clk_1;

            trigger_level      <= trigger_level_clk_2;
            trigger_enable     <= trigger_enable_clk_2;
            trigger_rising     <= trigger_rising_clk_2;
            pretrigger_count  <= pretrigger_count_clk_2;
            posttrigger_count <= posttrigger_count_clk_2;
            sample_rate       <= sample_rate_clk_2;

            arm_pulse   <= arm_toggle_clk_2   != arm_toggle_seen;
            abort_pulse <= abort_toggle_clk_2 != abort_toggle_seen;
            clear_pulse <= clear_toggle_clk_2 != clear_toggle_seen;

            arm_toggle_seen   <= arm_toggle_clk_2;
            abort_toggle_seen <= abort_toggle_clk_2;
            clear_toggle_seen <= clear_toggle_clk_2;
        end
    end

endmodule
